'use strict';

const sqlParser = require('js-sql-parser');

// for science.  and if we have a common property we can add here
class QryRoot {
}

class QryAtomic extends QryRoot {
    constructor (val) {
        super();
        this.value = val;
    }
}

class QryDiatomic extends QryRoot {
    constructor (left, right) {
        super();
        this.left = left;
        this.right = right;
    }
}

class QryLiteral extends QryAtomic {
    // constructor param is the literal value

    eval () {
        return this.value;
    }
}

class QryIdentifier extends QryAtomic {
    // constructor param is the property name of the attribute

    eval (attribute) {
        return attribute[this.value];
    }
}

class QryArray extends QryAtomic {
    // constructor param is the array

    eval () {
        return this.value;
    }
}

class QryEquals extends QryDiatomic {
    eval (attribute) {
        return this.left.eval(attribute) === this.right.eval(attribute);
    }
}

class QryNotEquals extends QryDiatomic {
    eval (attribute) {
        return this.left.eval(attribute) !== this.right.eval(attribute);
    }
}

class QryGreaterEquals extends QryDiatomic {
    eval (attribute) {
        return this.left.eval(attribute) >= this.right.eval(attribute);
    }
}

class QryLessEquals extends QryDiatomic {
    eval (attribute) {
        return this.left.eval(attribute) <= this.right.eval(attribute);
    }
}

class QryGreater extends QryDiatomic {
    eval (attribute) {
        return this.left.eval(attribute) > this.right.eval(attribute);
    }
}

class QryLess extends QryDiatomic {
    eval (attribute) {
        return this.left.eval(attribute) < this.right.eval(attribute);
    }
}

class QryAnd extends QryDiatomic {
    eval (attribute) {
        return this.left.eval(attribute) && this.right.eval(attribute);
    }
}

class QryOr extends QryDiatomic {
    eval (attribute) {
        return this.left.eval(attribute) || this.right.eval(attribute);
    }
}

class QryIn extends QryDiatomic {
    constructor (left, right, hasNot) {
        super(left, right);
        this.hasNot = hasNot;
    }

    eval (attribute) {
        // we assume .right is an array (QryArray)
        const result = this.right.eval(attribute).includes(this.left.eval(attribute));
        return this.hasNot ? !result : result;
    }
}

class QryNot extends QryAtomic {
    eval (attribute) {
        return !this.value.eval(attribute);
    }
}

class QryParentheses extends QryAtomic {
    eval (attribute) {
        // INTENSE
        return this.value.eval(attribute);
    }
}

function sqlNodeToAqlNode (node) {

    // TODO figure out date fields
    // TODO add support for LIKE ?
    // TODO add support for datatype casting?

    const typeReactor = {
        AndExpression: n => {
            return new QryAnd(sqlNodeToAqlNode(n.left), sqlNodeToAqlNode(n.right));
        },
        OrExpression: n => {
            return new QryOr(sqlNodeToAqlNode(n.left), sqlNodeToAqlNode(n.right));
        },
        NotExpression: n => {
            return new QryNot(sqlNodeToAqlNode(n.value));
        },
        InExpressionListPredicate: n => {
            return new QryIn(sqlNodeToAqlNode(n.left), sqlNodeToAqlNode(n.right), !!n.hasNot);
        },
        ComparisonBooleanPrimary: n => {
            // TODO wrap lefts and rights in brackets?

            const operatorMap = {
                '=': QryEquals,
                '==': QryEquals,
                '===': QryEquals,
                '>': QryGreater,
                '>=': QryGreaterEquals,
                '<': QryLess,
                '<=': QryLessEquals,
                '!=': QryNotEquals,
                '!==': QryNotEquals
            };

            const aqlClass = operatorMap[n.operator];
            if (!aqlClass) {
                throw new Error('Encountered unsupported operator in filter. Unhandled operator: ' + n.operator);
            }

            return new aqlClass(sqlNodeToAqlNode(n.left), sqlNodeToAqlNode(n.right));
        },
        Identifier: n => {
            return new QryIdentifier(n.value);
        },
        Number: n => {
            // number in string form
            return new QryLiteral(Number(n.value));
        },
        String: n => {
            // remove embedded quotes from string
            // TODO check if escaped double quote actually exists or was just part of that debug form
            let s = n.value;
            if (s.startsWith('"') || s.startsWith(`'`)) {
                s = s.substring(1, s.length - 1);
            } else if (s.startsWith('\"')) {
                s = s.substring(2, s.length - 2);
            }
            return new QryLiteral(s);
        },
        Boolean: n => {
            // node values are in all caps
            return new QryLiteral(n.value.toLowerCase() === 'true');
        },
        ExpressionList: n => {
            // this code currently assumes that items in the expression list are literals.
            // if we need any dynamically generated stuff (i.e. checking against other attribute properties)
            // then this needs to change and the guts of QryArray.eval needs to generate the array at
            // every call (way less efficient)
            return new QryArray(n.value.map(nn => sqlNodeToAqlNode(nn).eval()));
        },
        SimpleExprParentheses: n => {
            // n.value here is an ExpressionList, but i've yet to see an instance where it has more than one element in the array.
            // for now we do a hack hoist up the first element. This hack lets us pre-evaluate other expression lists
            // that are filled with constants.

            // TODO invest some time to try to find a case where there is > 1 element, and ensure the ExpressionList result
            //      formatting doesn't break the equation.
            // TODO there could be some minor optimization in removing the brackets from the expression list
            //      or conversly not adding brackets here.  Would want to be confident we know n.value is
            //      always an expression list. Not urgent, no harm in redundant brackets.

            if (n.value.type === 'ExpressionList') {
                if (n.value.value.length > 1) {
                    console.warn(`While converting SQL to AQL, encountered a parsed bracket containing an ExpressionList with more than one element`, n.value);
                }
                return new QryParentheses(sqlNodeToAqlNode(n.value.value[0]));
            } else {
                // warn, and hail mary that we can just parse it
                console.warn(`While converting SQL to AQL, encountered a parsed bracket containing ${n.value.type} instead of ExpressionList`);
                return new QryParentheses(sqlNodeToAqlNode(n.value));
            }


        }
    }

    if (!typeReactor[node.type]) {
        throw new Error('Encountered unsupported query in filter. Unhandled type: ' + node.type);
    } else {
        return typeReactor[node.type](node);
    }
}

// TODO consider having a storage facility for IN arrays to avoid having to eval() parse them for every element
function sqlToAql (sqlWhere) {

    const fakeSQL = 'SELECT muffins FROM pod WHERE ' + sqlWhere;

    // the sqlParser will construct an object tree of the sql statement. we then iterate through the where clause tree
    // and covert each node to the equivalent javascript expression
    const queryTree = sqlParser.parse(fakeSQL);
    return sqlNodeToAqlNode(queryTree.value.where);
}

// todo rename to AQL - attribute query language/logic
//                AQF - attribute query format
function sqlArrayFilter (data, sqlWhere, attribAsProperty = false) {
    // attribAsProperty means where the attribute lives in relation to the array
    // {att} is a standard key-value object of attributes
    // [ {att} , {att}] would be the false case.  this is the format of attributes from the geoApi attribute loader
    // [ {attributes:{att}}, {attributes:{att}}] would be the true case. this is the format of attributes sitting in the graphics array of a filebased layer

    // convert the sql where clause to an attribute query language tree, then
    // use that to evaluate against each attribute.
    const aql = sqlToAql(sqlWhere);

    // split in two to avoid doing boolean check at every iteration
    if (attribAsProperty) {
        return data.filter(a => {
            return aql.eval(a.attributes); 
         });
    } else {
        return data.filter(a => {
            return aql.eval(a); 
         });
    }
}

// variant of above function.  customized for turning graphics visibility on and off.
// since we need to turn off the items "not in the query", this saves us doing multiple iterations.
function sqlArrayGraphicSpecial (graphics, sqlWhere, attribAsProperty = true) {
    // attribAsProperty means where the attribute lives in relation to the array
    // {att} is a standard key-value object of attributes
    // [ {att} , {att}] would be the false case.  this is the format of attributes from the geoApi attribute loader
    // [ {attributes:{att}}, {attributes:{att}}] would be the true case. this is the format of attributes sitting in the graphics array of a filebased layer

    // convert the sql where clause to a javascript boolean expression, then use it in an array filter,
    // leveraging the power of the mighty eval()

    // important. this var needs to be called `opts` as it is used inside the eval (as an efficieny trick)
    const opts = {
        attObj: attribAsProperty ? 'a.attributes.' : 'a.',
        inArrays: []
    };
    const jql = sqlToJql(sqlWhere);
    console.log('Here is some JQL: ' + jql);
    // important. the iterator var needs to be called `a` as it is used inside the eval to reference the item
    graphics.forEach(a => {
        if (eval(jql)) {
            a.show();
        } else {
            a.hide();
        }
     });
}

module.exports = () => ({
    sqlArrayFilter,
    sqlArrayGraphicSpecial
});
