/* Loads the MagicMirror helper without installing MagicMirror on the development Mac. */
"use strict";
const path = require("node:path");
const Module = require("node:module");
module.exports = {create: definition => definition};
module.exports.loadDefinition = () => {
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function(request,...rest) {
    if (request === "node_helper") return __filename;
    return resolve.call(this,request,...rest);
  };
  try {
    const file = path.join(__dirname,"..","node_helper.js");
    delete require.cache[require.resolve(file)];
    return require(file);
  } finally { Module._resolveFilename = resolve; }
};
