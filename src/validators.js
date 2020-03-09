// Functions implementing the validators of SHACL-JS
// Also include validators for the constraint components of the DASH namespace

// Also included: implementations of the standard DASH functions

// There is no validator for sh:property as this is expected to be
// natively implemented by the surrounding engine.
const RDFQuery = require('./rdfquery')
const RDFQueryUtil = require('./rdfquery/util')
const NodeSet = RDFQuery.NodeSet
const { sh, xsd } = require('./namespaces')

const XSDIntegerTypes = new NodeSet()
XSDIntegerTypes.add(xsd.integer)

const XSDDecimalTypes = new NodeSet()
XSDDecimalTypes.addAll(XSDIntegerTypes.toArray())
XSDDecimalTypes.add(xsd.decimal)
XSDDecimalTypes.add(xsd.float)

function validateAnd ($context, $value, $and) {
  const shapes = new RDFQueryUtil($context.$shapes).rdfListToArray($and)
  for (let i = 0; i < shapes.length; i++) {
    if (!$context.nodeConformsToShape($value, shapes[i])) {
      return false
    }
  }
  return true
}

function validateClass ($context, $value, $class) {
  return new RDFQueryUtil($context.$data).isInstanceOf($value, $class)
}

function validateClosed ($context, $value, $closed, $ignoredProperties, $currentShape) {
  if (!$context.factory.term('true').equals($closed)) {
    return
  }
  const allowed = $context.$shapes.query()
    .match($currentShape, 'sh:property', '?propertyShape')
    .match('?propertyShape', 'sh:path', '?path')
    .filter(function (solution) { return solution.path.termType === 'NamedNode' })
    .getNodeSet('?path')
  if ($ignoredProperties) {
    allowed.addAll(new RDFQueryUtil($context.$shapes).rdfListToArray($ignoredProperties))
  }
  const results = []
  $context.$data.query()
    .match($value, '?predicate', '?object')
    .filter(function (sol) { return !allowed.contains(sol.predicate) })
    .forEach(function (sol) {
      results.push({
        path: sol.predicate,
        value: sol.object
      })
    })
  return results
}

function validateDatatype ($context, $value, $datatype) {
  if ($value.termType === 'Literal') {
    return $datatype.equals($value.datatype) && isValidForDatatype($value.value, $datatype)
  } else {
    return false
  }
}

function validateDisjoint ($context, $this, $value, $disjoint) {
  return !$context.$data.query().match($this, $disjoint, $value).hasSolution()
}

function validateEqualsProperty ($context, $this, $path, $equals) {
  const results = []
  const path = toRDFQueryPath($context, $path)
  $context.$data.query().path($this, path, '?value').forEach(
    function (solution) {
      if (!$context.$data.query().match($this, $equals, solution.value).hasSolution()) {
        results.push({
          value: solution.value
        })
      }
    })
  $context.$data.query().match($this, $equals, '?value').forEach(
    function (solution) {
      if (!$context.$data.query().path($this, path, solution.value).hasSolution()) {
        results.push({
          value: solution.value
        })
      }
    })
  return results
}

function validateEqualsNode ($context, $this, $equals) {
  const results = []
  let solutions = 0
  $context.$data.query().path($this, $equals, '?value').forEach(
    function (solution) {
      solutions++
      if ($context.compareNodes($this, solution.value) !== 0) {
        results.push({
          value: solution.value
        })
      }
    })
  if (results.length === 0 && solutions === 0) {
    results.push({
      value: $this
    })
  }
  return results
}

function validateHasValueNode ($context, $this, $hasValue) {
  return $this.equals($hasValue)
}

function validateHasValueProperty ($context, $this, $path, $hasValue) {
  const count = $context.$data.query().path($this, toRDFQueryPath($context, $path), $hasValue).getCount()
  return count > 0
}

function validateIn ($context, $value, $in) {
  const set = new NodeSet()
  set.addAll(new RDFQueryUtil($context.$shapes).rdfListToArray($in))
  return set.contains($value)
}

function validateLanguageIn ($context, $value, $languageIn) {
  if ($value.termType !== 'Literal') {
    return false
  }
  const lang = $value.language
  if (!lang || lang === '') {
    return false
  }
  const ls = new RDFQueryUtil($context.$shapes).rdfListToArray($languageIn)
  for (let i = 0; i < ls.length; i++) {
    if (lang.startsWith(ls[i].value)) {
      return true
    }
  }
  return false
}

function validateLessThanProperty ($context, $this, $path, $lessThan) {
  const results = []
  $context.$data.query()
    .path($this, toRDFQueryPath($context, $path), '?value')
    .match($this, $lessThan, '?otherValue')
    .forEach(function (sol) {
      const c = $context.compareNodes(sol.value, sol.otherValue)
      if (c == null || c >= 0) {
        results.push({
          value: sol.value
        })
      }
    })
  return results
}

function validateLessThanOrEqualsProperty ($context, $this, $path, $lessThanOrEquals) {
  const results = []
  $context.$data.query()
    .path($this, toRDFQueryPath($context, $path), '?value')
    .match($this, $lessThanOrEquals, '?otherValue')
    .forEach(function (sol) {
      const c = $context.compareNodes(sol.value, sol.otherValue)
      if (c == null || c > 0) {
        results.push({
          value: sol.value
        })
      }
    })
  return results
}

function validateMaxCountProperty ($context, $this, $path, $maxCount) {
  const count = $context.$data.query().path($this, toRDFQueryPath($context, $path), '?any').getCount()
  return count <= Number($maxCount.value)
}

function validateMaxExclusive ($context, $value, $maxExclusive) {
  return $value.termType === 'Literal' && Number($value.value) < Number($maxExclusive.value)
}

function validateMaxInclusive ($context, $value, $maxInclusive) {
  return $value.termType === 'Literal' && Number($value.value) <= Number($maxInclusive.value)
}

function validateMaxLength ($context, $value, $maxLength) {
  if ($value.termType === 'BlankNode') {
    return false
  }
  return $value.value.length <= Number($maxLength.value)
}

function validateMinCountProperty ($context, $this, $path, $minCount) {
  const count = $context.$data.query().path($this, toRDFQueryPath($context, $path), '?any').getCount()
  return count >= Number($minCount.value)
}

function validateMinExclusive ($context, $value, $minExclusive) {
  return $value.termType === 'Literal' && Number($value.value) > Number($minExclusive.value)
}

function validateMinInclusive ($context, $value, $minInclusive) {
  return $value.termType === 'Literal' && Number($value.value) >= Number($minInclusive.value)
}

function validateMinLength ($context, $value, $minLength) {
  if ($value.termType === 'BlankNode') {
    return false
  }
  return $value.value.length >= Number($minLength.value)
}

function validateNodeKind ($context, $value, $nodeKind) {
  if ($value.termType === 'BlankNode') {
    return sh.BlankNode.equals($nodeKind) ||
      sh.BlankNodeOrIRI.equals($nodeKind) ||
      sh.BlankNodeOrLiteral.equals($nodeKind)
  } else if ($value.termType === 'NamedNode') {
    return sh.IRI.equals($nodeKind) ||
      sh.BlankNodeOrIRI.equals($nodeKind) ||
      sh.IRIOrLiteral.equals($nodeKind)
  } else if ($value.termType === 'Literal') {
    return sh.Literal.equals($nodeKind) ||
      sh.BlankNodeOrLiteral.equals($nodeKind) ||
      sh.IRIOrLiteral.equals($nodeKind)
  }
}

function validateNode ($context, $value, $node) {
  return $context.nodeConformsToShape($value, $node)
}

function validateNot ($context, $value, $not) {
  return !$context.nodeConformsToShape($value, $not)
}

function validateOr ($context, $value, $or) {
  const shapes = new RDFQueryUtil($context.$shapes).rdfListToArray($or)
  for (let i = 0; i < shapes.length; i++) {
    if ($context.nodeConformsToShape($value, shapes[i])) {
      return true
    }
  }
  return false
}

function validatePattern ($context, $value, $pattern, $flags) {
  if ($value.termType === 'BlankNode') {
    return false
  }
  const re = $flags ? new RegExp($pattern.value, $flags.value) : new RegExp($pattern.value)
  return re.test($value.value)
}

function validateQualifiedMaxCountProperty ($context, $this, $path, $qualifiedValueShape, $qualifiedValueShapesDisjoint, $qualifiedMaxCount, $currentShape) {
  const c = validateQualifiedHelper($context, $this, $path, $qualifiedValueShape, $qualifiedValueShapesDisjoint, $currentShape)
  return $qualifiedMaxCount.termType === 'Literal' && c <= Number($qualifiedMaxCount.value)
}

function validateQualifiedMinCountProperty ($context, $this, $path, $qualifiedValueShape, $qualifiedValueShapesDisjoint, $qualifiedMinCount, $currentShape) {
  const c = validateQualifiedHelper($context, $this, $path, $qualifiedValueShape, $qualifiedValueShapesDisjoint, $currentShape)
  return $qualifiedMinCount.termType === 'Literal' && c >= Number($qualifiedMinCount.value)
}

function validateQualifiedHelper ($context, $this, $path, $qualifiedValueShape, $qualifiedValueShapesDisjoint, $currentShape) {
  const siblingShapes = new NodeSet()
  if ($context.factory.term('true').equals($qualifiedValueShapesDisjoint)) {
    $context.$shapes.query()
      .match('?parentShape', 'sh:property', $currentShape)
      .match('?parentShape', 'sh:property', '?sibling')
      .match('?sibling', 'sh:qualifiedValueShape', '?siblingShape')
      .filter(RDFQuery.exprNotEquals('?siblingShape', $qualifiedValueShape))
      .addAllNodes('?siblingShape', siblingShapes)
  }
  return $context.$data.query()
    .path($this, toRDFQueryPath($context, $path), '?value')
    .filter(function (sol) {
      return $context.nodeConformsToShape(sol.value, $qualifiedValueShape) &&
        !validateQualifiedConformsToASibling($context, sol.value, siblingShapes.toArray())
    })
    .getCount()
}

function validateQualifiedConformsToASibling ($context, value, siblingShapes) {
  for (let i = 0; i < siblingShapes.length; i++) {
    if ($context.nodeConformsToShape(value, siblingShapes[i])) {
      return true
    }
  }
  return false
}

function validateUniqueLangProperty ($context, $this, $uniqueLang, $path) {
  if (!$context.factory.term('true').equals($uniqueLang)) {
    return
  }
  const map = {}
  $context.$data.query().path($this, toRDFQueryPath($context, $path), '?value').forEach(function (sol) {
    const lang = sol.value.language
    if (lang && lang !== '') {
      const old = map[lang]
      if (!old) {
        map[lang] = 1
      } else {
        map[lang] = old + 1
      }
    }
  })
  const results = []
  for (const lang in map) {
    if (Object.prototype.hasOwnProperty.call(map, lang)) {
      const count = map[lang]
      if (count > 1) {
        results.push('Language "' + lang + '" has been used by ' + count + ' values')
      }
    }
  }
  return results
}

function validateXone ($context, $value, $xone) {
  const shapes = new RDFQueryUtil($context.$shapes).rdfListToArray($xone)
  let count = 0
  for (let i = 0; i < shapes.length; i++) {
    if ($context.nodeConformsToShape($value, shapes[i])) {
      count++
    }
  }
  return count === 1
}

// Utilities ------------------------------------------------------------------

function toRDFQueryPath ($context, shPath) {
  if (shPath.termType === 'Collection') {
    const paths = new RDFQueryUtil($context.$shapes).rdfListToArray(shPath)
    const result = []
    for (let i = 0; i < paths.length; i++) {
      result.push(toRDFQueryPath($context, paths[i]))
    }
    return result
  }
  if (shPath.termType === 'NamedNode') {
    return shPath
  } else if (shPath.termType === 'BlankNode') {
    const util = new RDFQueryUtil($context.$shapes)
    if ($context.$shapes.query().getObject(shPath, 'rdf:first')) {
      const paths = util.rdfListToArray(shPath)
      const result = []
      for (let i = 0; i < paths.length; i++) {
        result.push(toRDFQueryPath($context, paths[i]))
      }
      return result
    }
    const alternativePath = $context.$shapes.query().getObject(shPath, 'sh:alternativePath')
    if (alternativePath) {
      const paths = util.rdfListToArray(alternativePath)
      const result = []
      for (let i = 0; i < paths.length; i++) {
        result.push(toRDFQueryPath($context, paths[i]))
      }
      return { or: result }
    }
    const zeroOrMorePath = $context.$shapes.query().getObject(shPath, 'sh:zeroOrMorePath')
    if (zeroOrMorePath) {
      return { zeroOrMore: toRDFQueryPath($context, zeroOrMorePath) }
    }
    const oneOrMorePath = $context.$shapes.query().getObject(shPath, 'sh:oneOrMorePath')
    if (oneOrMorePath) {
      return { oneOrMore: toRDFQueryPath($context, oneOrMorePath) }
    }
    const zeroOrOnePath = $context.$shapes.query().getObject(shPath, 'sh:zeroOrOnePath')
    if (zeroOrOnePath) {
      return { zeroOrOne: toRDFQueryPath($context, zeroOrOnePath) }
    }
    const inversePath = $context.$shapes.query().getObject(shPath, 'sh:inversePath')
    if (inversePath) {
      return { inverse: toRDFQueryPath($context, inversePath) }
    }
  }
  throw new Error('Unsupported SHACL path ' + shPath)
  // TODO: implement conforming to AbstractQuery.path syntax
  // return shPath
}

// Private helper functions

// TODO: Support more datatypes
function isValidForDatatype (lex, datatype) {
  if (XSDIntegerTypes.contains(datatype)) {
    const r = parseInt(lex)
    return !isNaN(r)
  } else if (XSDDecimalTypes.contains(datatype)) {
    const r = parseFloat(lex)
    return !isNaN(r)
  } else if (datatype.value === 'http://www.w3.org/2001/XMLSchema#boolean') {
    return lex === 'true' || lex === 'false'
  } else {
    return true
  }
}

module.exports = {
  validateAnd,
  validateClass,
  validateClosed,
  validateDatatype,
  validateDisjoint,
  validateEqualsNode,
  validateEqualsProperty,
  validateHasValueNode,
  validateHasValueProperty,
  validateIn,
  validateLanguageIn,
  validateLessThanProperty,
  validateLessThanOrEqualsProperty,
  validateMaxCountProperty,
  validateMaxExclusive,
  validateMaxInclusive,
  validateMaxLength,
  validateMinCountProperty,
  validateMinExclusive,
  validateMinInclusive,
  validateMinLength,
  validateNode,
  validateNodeKind,
  validateNot,
  validateOr,
  validatePattern,
  validateQualifiedMaxCountProperty,
  validateQualifiedMinCountProperty,
  validateUniqueLangProperty,
  validateXone
}
