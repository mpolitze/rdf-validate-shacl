// Design:
//
// First, derive a ShapesGraph object from the definitions in $shapes.
// This manages a map of parameters to ConstraintComponents.
// Each ConstraintComponent manages its list of parameters and a link to the validators.
//
// The ShapesGraph also manages a list of Shapes, each which has a list of Constraints.
// A Constraint is a specific combination of parameters for a constraint component,
// and has functions to access the target nodes.
//
// Each ShapesGraph can be reused between validation calls, and thus often only needs
// to be created once per application.
//
// The validation process is started by creating a ValidationEngine that relies on
// a given ShapesGraph and operates on the current $data().
// It basically walks through all Shapes that have target nodes and runs the validators
// for each Constraint of the shape, producing results along the way.

const NodeSet = require('./node-set')
const ValidationFunction = require('./validation-function')
const validatorsRegistry = require('./validators-registry')
const { extractPropertyPath, getPathObjects } = require('./property-path')
const { rdfs, sh } = require('./namespaces')

class ShapesGraph {
  constructor (context) {
    this.context = context

    // Collect all defined constraint components
    const componentNodes = context.$shapes.getInstancesOf(sh.ConstraintComponent)
    this.components = [...componentNodes].map((node) => new ConstraintComponent(node, context))

    // Build map from parameters to constraint components
    this.parametersMap = {}
    for (const component of this.components) {
      for (const parameter of component.parameters) {
        this.parametersMap[parameter.value] = component
      }
    }

    // Collection of shapes is populated on demand - here we remember the instances
    this.shapes = {} // Keys are the URIs/bnode ids of the shape nodes
  }

  getComponentWithParameter (parameter) {
    return this.parametersMap[parameter.value]
  }

  getShape (shapeNode) {
    let shape = this.shapes[shapeNode.value]
    if (!shape) {
      shape = new Shape(this.context, shapeNode)
      this.shapes[shapeNode.value] = shape
    }
    return shape
  }

  getShapeNodesWithConstraints () {
    if (!this.shapeNodesWithConstraints) {
      const set = new NodeSet()
      for (const component of this.components) {
        const params = component.requiredParameters
        for (const param of params) {
          const shapesWithParam = [...this.context.$shapes
            .match(null, param, null)]
            .map(({ subject }) => subject)
          set.addAll(shapesWithParam)
        }
      }
      this.shapeNodesWithConstraints = [...set]
    }
    return this.shapeNodesWithConstraints
  }

  getShapesWithTarget () {
    const $shapes = this.context.$shapes

    if (!this.targetShapes) {
      this.targetShapes = []
      const shapeNodes = this.getShapeNodesWithConstraints()
      for (const shapeNode of shapeNodes) {
        if (
          $shapes.isInstanceOf(shapeNode, rdfs.Class) ||
          $shapes.cf.node(shapeNode).out([
            sh.targetClass,
            sh.targetNode,
            sh.targetSubjectsOf,
            sh.targetObjectsOf,
            sh.target
          ]).terms.length > 0
        ) {
          this.targetShapes.push(this.getShape(shapeNode))
        }
      }
    }

    return this.targetShapes
  }
}

class Constraint {
  constructor (shape, component, paramValue, rdfShapesGraph) {
    this.shape = shape
    this.component = component
    this.paramValue = paramValue
    this.shapeNodeCf = rdfShapesGraph.cf.node(shape.shapeNode)
  }

  getParameterValue (param) {
    return this.paramValue || this.shapeNodeCf.out(param).term
  }

  get componentMessages () {
    return this.component.getMessages(this.shape)
  }
}

class ConstraintComponent {
  constructor (node, context) {
    this.context = context
    this.factory = context.factory
    this.node = node

    this.parameters = []
    this.parameterNodes = []
    this.requiredParameters = []
    this.optionals = {}
    this.context.$shapes.cf
      .node(node)
      .out(sh.parameter)
      .forEach(parameterCf => {
        const parameter = parameterCf.term

        parameterCf.out(sh.path).forEach(({ term: path }) => {
          this.parameters.push(path)
          this.parameterNodes.push(parameter)
          if (this.context.$shapes.match(parameter, sh.optional, this.factory.true).size > 0) {
            this.optionals[path.value] = true
          } else {
            this.requiredParameters.push(path)
          }
        })
      })

    this.nodeValidationFunction = this.findValidationFunction(sh.nodeValidator)
    if (!this.nodeValidationFunction) {
      this.nodeValidationFunction = this.findValidationFunction(sh.validator)
      this.nodeValidationFunctionGeneric = true
    }
    this.propertyValidationFunction = this.findValidationFunction(sh.propertyValidator)
    if (!this.propertyValidationFunction) {
      this.propertyValidationFunction = this.findValidationFunction(sh.validator)
      this.propertyValidationFunctionGeneric = true
    }
  }

  findValidationFunction (predicate) {
    const validatorType = predicate.value.split('#').slice(-1)[0]
    const validator = this.findValidator(validatorType)

    if (!validator) return null

    return new ValidationFunction(this.context, validator.func.name, validator.func)
  }

  getMessages (shape) {
    const generic = shape.isPropertyShape() ? this.propertyValidationFunctionGeneric : this.nodeValidationFunctionGeneric
    const validatorType = generic ? 'validator' : (shape.isPropertyShape() ? 'propertyValidator' : 'nodeValidator')
    const validator = this.findValidator(validatorType)

    if (!validator) return []

    const message = validator.message

    return message ? [message] : []
  }

  findValidator (validatorType) {
    const constraintValidators = validatorsRegistry[this.node.value]

    if (!constraintValidators) return null

    const validator = constraintValidators[validatorType]

    return validator || null
  }

  isComplete (shapeNode) {
    return !this.parameters.some((parameter) => (
      this.isRequired(parameter.value) &&
      this.context.$shapes.match(shapeNode, parameter, null).size === 0
    ))
  }

  isRequired (parameterURI) {
    return !this.optionals[parameterURI]
  }
}

class Shape {
  constructor (context, shapeNode) {
    this.context = context
    this.severity = context.$shapes.cf.node(shapeNode).out(sh.severity).term

    if (!this.severity) {
      this.severity = context.factory.ns.sh.Violation
    }

    this.deactivated = context.$shapes.cf.node(shapeNode).out(sh.deactivated).value === 'true'
    this.path = context.$shapes.cf.node(shapeNode).out(sh.path).term
    this._pathObject = undefined
    this.shapeNode = shapeNode
    this.constraints = []

    const handled = new NodeSet()
    const shapeProperties = [...context.$shapes.match(shapeNode, null, null)]
    shapeProperties.forEach((sol) => {
      const component = this.context.shapesGraph.getComponentWithParameter(sol.predicate)
      if (component && !handled.has(component.node)) {
        const params = component.parameters
        if (params.length === 1) {
          this.constraints.push(new Constraint(this, component, sol.object, context.$shapes))
        } else if (component.isComplete(shapeNode)) {
          this.constraints.push(new Constraint(this, component, undefined, context.$shapes))
          handled.add(component.node)
        }
      }
    })
  }

  /**
   * Property path object
   */
  get pathObject () {
    if (this._pathObject === undefined) {
      this._pathObject = this.path ? extractPropertyPath(this.context.$shapes, this.path) : null
    }

    return this._pathObject
  }

  getTargetNodes (rdfDataGraph) {
    const results = new NodeSet()

    if (this.context.$shapes.isInstanceOf(this.shapeNode, rdfs.Class)) {
      results.addAll(rdfDataGraph.getInstancesOf(this.shapeNode))
    }

    const targetClasses = [...this.context.$shapes.match(this.shapeNode, sh.targetClass, null)]
    targetClasses.forEach(({ object: targetClass }) => {
      results.addAll(rdfDataGraph.getInstancesOf(targetClass))
    })

    results.addAll(this.context.$shapes.cf.node(this.shapeNode).out(sh.targetNode).terms)

    this.context.$shapes.cf
      .node(this.shapeNode)
      .out(sh.targetSubjectsOf)
      .terms
      .forEach((predicate) => {
        const subjects = [...rdfDataGraph.match(null, predicate, null)].map(({ subject }) => subject)
        results.addAll(subjects)
      })

    this.context.$shapes.cf
      .node(this.shapeNode)
      .out(sh.targetObjectsOf)
      .terms
      .forEach((predicate) => {
        const objects = [...rdfDataGraph.match(null, predicate, null)].map(({ object }) => object)
        results.addAll(objects)
      })

    return [...results]
  }

  getValueNodes (focusNode, dataGraph) {
    if (this.path) {
      return getPathObjects(dataGraph, focusNode, this.pathObject)
    } else {
      return [focusNode]
    }
  }

  isPropertyShape () {
    return this.path != null
  }
}

module.exports = ShapesGraph
