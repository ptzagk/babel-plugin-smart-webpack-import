/* eslint-disable filenames/match-exported */
import json5 from "json5"
import { dirname, basename, extname } from "path"
import crypto from "crypto"
import basex from "base-x"

const base62 = basex("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")

const DEFAULT_LENGTH = 5
function hashString(input, precision = DEFAULT_LENGTH) {
  return base62
    .encode(
      crypto
        .createHash("sha256")
        .update(input)
        .digest()
    )
    .slice(0, precision)
}

function getImportArgPath(path) {
  return path.parentPath.get("arguments")[0]
}

export default function smartWebpackImport({ types, template }) {
  const visited = Symbol("visited")

  return {
    name: "better-import",
    visitor: {
      Import(path, state) {
        /* eslint-disable immutable/no-mutation */
        /* eslint-disable prefer-template */

        if (path[visited]) {
          return
        }
        path[visited] = true

        const importArg = getImportArgPath(path)
        const importArgNode = importArg.node
        const { quasis, expressions, leadingComments } = importArgNode

        const requester = dirname(state.file.opts.filename)
        const request = quasis ? quasis[0].value.cooked : importArgNode.value

        // There exists the possibility of non usable value. Typically only
        // when the user has import() statements with other complex data, but
        // not a string or template string. We handle this gracefully by ignoring.
        if (request == null) {
          return
        }

        const jsonContent = {}

        // Try to parse all previous comments
        if (leadingComments) {
          leadingComments.forEach((comment, index) => {
            // Skip empty comments
            if (!comment.value.trim()) {
              return
            }

            // Webpack magic comments are declared as JSON5 but miss the curly braces.
            let parsed
            try {
              parsed = json5.parse("{" + comment.value + "}")
            } catch (err) {
              // Most probably a non JSON5 comment
              return
            }

            // Skip comment processing if it already contains a chunk name
            if (parsed.webpackChunkName) {
              jsonContent.webpackChunkName = true
              return
            }

            // We copy over all fields and...
            for (const key in parsed) {
              jsonContent[key] = parsed[key]
            }

            // Cleanup the parsed comment afterwards
            comment.value = ""
          })
        }

        if (!jsonContent.webpackChunkName) {
          const hasExpressions = expressions && expressions.length > 0

          // Append [request] as placeholder for dynamic part in WebpackChunkName
          const fullRequest = hasExpressions ? request + "[request]" : request

          // Prepend some clean identifier of the static part when using expressions.
          // This is not required to work, but helps users to identify different chunks.
          const requestPrefix = hasExpressions ? request.replace(/^[./]+|(\.js$)/g, "").replace(/\//g, "-") : ""

          // Cleanup combined request to not contain any paths info
          const plainRequest = basename(fullRequest, extname(fullRequest))

          // Hash request origin and request
          const importHash = hashString(requester + "::" + request)

          // Add our chunk name to the previously parsed values
          jsonContent.webpackChunkName = requestPrefix + plainRequest + "-" + importHash

          // Convert to string and remove outer JSON object symbols {}
          const magicComment = json5.stringify(jsonContent).slice(1, -1)

          // Add as a new leading comment
          importArg.addComment("leading", magicComment)
        }
      }
    }
  }
}
