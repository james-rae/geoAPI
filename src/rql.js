'use strict';

const sqlParser = require('js-sql-parser');

function sqlNodeToJql (node, opts) {

    // TODO figure out date fields
    // TODO add support for LIKE ?

    const typeReactor = {
        AndExpression: n => {
            return `(${sqlNodeToJql(n.left, opts)} && ${sqlNodeToJql(n.right, opts)})`;
        },
        OrExpression: n => {
            return `(${sqlNodeToJql(n.left, opts)} || ${sqlNodeToJql(n.right, opts)})`;
        },
        NotExpression: n => {
            return `!(${sqlNodeToJql(n.value, opts)})`; // nice function...not
        },
        InExpressionListPredicate: n => {
            // converts to array, does an includes call on it. adds not if needed
            // rather than encode the array in the primary string, we eval() and
            // store it here. Being in the main string means large arrays of OIDs
            // would get eval-parsed for every item in the array being searched.
            // this trick means eval'ing it once.
            const list = eval(`[${sqlNodeToJql(n.right, opts)}]`);
            opts.inArrays.push(list);
            return `(${n.hasNot ? '!' : ''}opts.inArrays[${opts.inArrays.length - 1}].includes(${sqlNodeToJql(n.left, opts)}))`;
        },
        ComparisonBooleanPrimary: n => {
            // TODO wrap lefts and rights in brackets?

            const operatorMap = {
                '=': '===',
                '==': '===',
                '===': '===',
                '>': '>',
                '>=': '>=',
                '<': '<',
                '<=': '<=',
                '!=': '!==',
                '!==': '!=='
            };

            const jqlOp = operatorMap[n.operator];
            if (!jqlOp) {
                console.error('Encountered unsupported operator in filter. Unhandled operator: ' + n.operator);
                // TODO consider doing hard error
                return "(true)";
            }

            return `(${sqlNodeToJql(n.left, opts)} ${jqlOp} ${sqlNodeToJql(n.right, opts)})`;
        },
        Identifier: n => {
            // tack the object containing the attributes to the attribute name
            return opts.attObj + n.value;
        },
        Number: n => {
            // number in string form
            return n.value;
        },
        String: n => {
            // if enclosed in doublequotes or escaped double quotes, change to single quotes
            // TODO check if escaped double quote actually exists or was just part of that debug form
            // TODO is is possible for the library to pass in a value that is not wrapped in quotes?
            let s = n.value;
            if (s.startsWith('"')) {
                s = `'${s.substring(1, s.length - 1)}'`;
            } else if (s.startsWith('\"')) {
                s = `'${s.substring(2, s.length - 2)}'`;
            }
            return s;
        },
        Boolean: n => {
            // node values are in all caps
            return n.value.toLowerCase();
        },
        ExpressionList: n => {
            // returns in "array guts format". i.e. comma separated, but does not put [ ] around it.
            // parent of the expression list needs to determine what to do with the guts.
            return n.value.map(nn => sqlNodeToJql(nn, opts)).join();
        },
        SimpleExprParentheses: n => {
            // n.value here is an ExpressionList, but i've yet to see an instance where it has more than one element in the array.
            // TODO invest some time to try to find a case where there is > 1 element, and ensure the ExpressionList result
            //      formatting doesn't break the equation.
            return `(${sqlNodeToJql(n.value, opts)})`;
        }
    }

    if (!typeReactor[node.type]) {
        console.error('Encountered unsupported query in filter. Unhandled type: ' + node.type);
        return ''; // TODO determine if we should throw a hard error
    } else {
        return typeReactor[node.type](node);
    }
}

// TODO consider having a storage facility for IN arrays to avoid having to eval() parse them for every element
function sqlToJql (sqlWhere, opts) {

    const fakeSQL = 'SELECT muffins FROM pod WHERE ' + sqlWhere;

    // the sqlParser will construct an object tree of the sql statement. we then iterate through the where clause tree
    // and covert each node to the equivalent javascript expression
    const queryTree = sqlParser.parse(fakeSQL);
    return sqlNodeToJql(queryTree.value.where, opts);
}

// todo rename to AQL - attribute query language/logic
//                AQF - attribute query format
function sqlArrayQuery (data, sqlWhere) {
    // attribAsProperty means where the attribute lives in relation to the array
    // {att} is a standard key-value object of attributes
    // [ {att} , {att}] would be the false case.  this is the format of attributes from the geoApi attribute loader
    // [ {attributes:{att}}, {attributes:{att}}] would be the true case. this is the format of attributes sitting in the graphics array of a filebased layer
    // TODO turn this into optional param default false
    const attribAsProperty = false;

    // convert the sql where clause to a javascript boolean expression, then use it in an array filter,
    // leveraging the power of the mighty eval()

    // important. this var needs to be called `opts` as it is used inside the eval (as an efficieny trick)
    const opts = {
        attObj: attribAsProperty ? 'a.attributes.' : 'a.',
        inArrays: []
    };
    const jql = sqlToJql(sqlWhere, opts);
    console.log('Here is some JQL: ' + jql);
    const mySearch = data.filter(a => {
        return eval(jql); 
     });

     return mySearch;
}

module.exports = () => ({
    sqlArrayQuery
});
