'use strict';

const sqlParser = require('js-sql-parser');

function sqlNodeToJql (node, attObj = "a.") {

    // TODO figure out date fields
    // TODO add support for LIKE ?

    const typeReactor = {
        AndExpression: n => {
            return `(${sqlNodeToJql(n.left, attObj)} && ${sqlNodeToJql(n.right, attObj)})`;
        },
        OrExpression: n => {
            return `(${sqlNodeToJql(n.left, attObj)} || ${sqlNodeToJql(n.right, attObj)})`;
        },
        NotExpression: n => {
            return `!(${sqlNodeToJql(n.value, attObj)})`; // nice function...not
        },
        InExpressionListPredicate: n => {
            // converts to array, does an includes call on it. adds not if needed
            return `(${n.hasNot ? '!' : ''}[${sqlNodeToJql(n.right, attObj)}].includes(${sqlNodeToJql(n.left, attObj)}))`;
        },
        ComparisonBooleanPrimary: n => {
            // for now be lazy and use operator raw.
            // can enhance later to be more robust.
            // e.g.
            // TODO check for unsupported operators
            // TODO wrap lefts and rights in brackets

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

            return `(${sqlNodeToJql(n.left, attObj)} ${jqlOp} ${sqlNodeToJql(n.right, attObj)})`;
        },
        Identifier: n => {
            // tack the object containing the attributes to the attribute name
            return attObj + n.value;
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
            return n.value.map(nn => sqlNodeToJql(nn, attObj)).join();
        },
        SimpleExprParentheses: n => {
            return `(${sqlNodeToJql(n.value, attObj)})`;
        }
    }

    if (!typeReactor[node.type]) {
        console.error('Encountered unsupported query in filter. Unhandled type: ' + node.type);
        return ''; // TODO determine if we should throw a hard error
    } else {
        return typeReactor[node.type](node);
    }
}

function sqlToJql (sqlWhere, attribAsProperty = false) {
    // attribAsProperty means where the attribute lives in relation to the array
    // {att} is a standard key-value object of attributes
    // [ {att} , {att}] would be the false case.  this is the format of attributes from the geoApi attribute loader
    // [ {attributes:{att}}, {attributes:{att}}] would be the true case. this is the format of attributes sitting in the graphics array of a filebased layer

    const attQualifier = attribAsProperty ? 'a.attributes.' : 'a.';
    const fakeSQL = 'SELECT muffins FROM pod WHERE ' + sqlWhere;
    const queryTree = sqlParser.parse(fakeSQL);
    return sqlNodeToJql(queryTree.value.where, attQualifier);
}

// todo rename to AQL - attribute query language/logic
//                AQF - attribute query format
function jqlArrayQuery (data, sqlWhere) {
    // TODO add in attribAsProperty boolean magic
    const jql = sqlToJql(sqlWhere);
    console.log('Here is some JQL: ' + jql);
    const mySearch = data.filter(a => {
        return eval(jql); 
     });

     return mySearch;
}

module.exports = () => ({
    jqlArrayQuery
});
