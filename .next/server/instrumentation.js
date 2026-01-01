"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(() => {
var exports = {};
exports.id = "instrumentation";
exports.ids = ["instrumentation"];
exports.modules = {

/***/ "assert":
/*!*************************!*\
  !*** external "assert" ***!
  \*************************/
/***/ ((module) => {

module.exports = require("assert");

/***/ }),

/***/ "crypto":
/*!*************************!*\
  !*** external "crypto" ***!
  \*************************/
/***/ ((module) => {

module.exports = require("crypto");

/***/ }),

/***/ "events":
/*!*************************!*\
  !*** external "events" ***!
  \*************************/
/***/ ((module) => {

module.exports = require("events");

/***/ }),

/***/ "net":
/*!**********************!*\
  !*** external "net" ***!
  \**********************/
/***/ ((module) => {

module.exports = require("net");

/***/ }),

/***/ "tls":
/*!**********************!*\
  !*** external "tls" ***!
  \**********************/
/***/ ((module) => {

module.exports = require("tls");

/***/ }),

/***/ "util":
/*!***********************!*\
  !*** external "util" ***!
  \***********************/
/***/ ((module) => {

module.exports = require("util");

/***/ }),

/***/ "zlib":
/*!***********************!*\
  !*** external "zlib" ***!
  \***********************/
/***/ ((module) => {

module.exports = require("zlib");

/***/ }),

/***/ "(instrument)/./src/instrumentation.ts":
/*!********************************!*\
  !*** ./src/instrumentation.ts ***!
  \********************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   register: () => (/* binding */ register)\n/* harmony export */ });\n// ============================================================================\n// NEXT.JS INSTRUMENTATION\n// ============================================================================\n//\n// This file runs once when the Next.js server starts.\n// We use it to initialize the Kafka consumer so it runs in the same\n// process as the Next.js server, sharing memory with SSE connections.\n//\n// Documentation: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation\n//\n// ============================================================================\nasync function register() {\n    console.log(\"[Instrumentation] Register called, runtime:\", \"nodejs\", \"PID:\", process.pid);\n    // Only run on the server (not in edge runtime or client)\n    // In development, this runs in the Node.js runtime\n    if (true) {\n        console.log(\"[Instrumentation] Initializing Kafka consumer...\");\n        try {\n            // Dynamically import to avoid bundling issues\n            const { startConsumer } = await Promise.all(/*! import() */[__webpack_require__.e(\"vendor-chunks/kafkajs\"), __webpack_require__.e(\"_instrument_src_lib_kafka_consumer_ts\")]).then(__webpack_require__.bind(__webpack_require__, /*! @/lib/kafka/consumer */ \"(instrument)/./src/lib/kafka/consumer.ts\"));\n            // Start the consumer\n            await startConsumer();\n            console.log(\"[Instrumentation] ✓ Kafka consumer started successfully\");\n        } catch (error) {\n            console.error(\"[Instrumentation] ✗ Failed to start Kafka consumer:\", error);\n            // Don't crash the server if Kafka is unavailable\n            // The app can still function without real-time updates\n            console.warn(\"[Instrumentation] Server will continue without real-time Kafka updates\");\n        }\n    } else {}\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKGluc3RydW1lbnQpLy4vc3JjL2luc3RydW1lbnRhdGlvbi50cyIsIm1hcHBpbmdzIjoiOzs7O0FBQUEsK0VBQStFO0FBQy9FLDBCQUEwQjtBQUMxQiwrRUFBK0U7QUFDL0UsRUFBRTtBQUNGLHNEQUFzRDtBQUN0RCxvRUFBb0U7QUFDcEUsc0VBQXNFO0FBQ3RFLEVBQUU7QUFDRixrR0FBa0c7QUFDbEcsRUFBRTtBQUNGLCtFQUErRTtBQUV4RSxlQUFlQTtJQUNwQkMsUUFBUUMsR0FBRyxDQUFDLCtDQUErQ0MsUUFBd0IsRUFBRSxRQUFRQSxRQUFRRyxHQUFHO0lBRXhHLHlEQUF5RDtJQUN6RCxtREFBbUQ7SUFDbkQsSUFBSUgsSUFBa0UsRUFBRTtRQUN0RUYsUUFBUUMsR0FBRyxDQUFDO1FBRVosSUFBSTtZQUNGLDhDQUE4QztZQUM5QyxNQUFNLEVBQUVLLGFBQWEsRUFBRSxHQUFHLE1BQU0sd1FBQU87WUFFdkMscUJBQXFCO1lBQ3JCLE1BQU1BO1lBRU5OLFFBQVFDLEdBQUcsQ0FBQztRQUNkLEVBQUUsT0FBT00sT0FBTztZQUNkUCxRQUFRTyxLQUFLLENBQUMsdURBQXVEQTtZQUNyRSxpREFBaUQ7WUFDakQsdURBQXVEO1lBQ3ZEUCxRQUFRUSxJQUFJLENBQUM7UUFDZjtJQUNGLE9BQU8sRUFFTjtBQUNIIiwic291cmNlcyI6WyJ3ZWJwYWNrOi8vdGlja2V0LWFwcC1wb2MvLi9zcmMvaW5zdHJ1bWVudGF0aW9uLnRzPzRmYWIiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTkVYVC5KUyBJTlNUUlVNRU5UQVRJT05cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vXG4vLyBUaGlzIGZpbGUgcnVucyBvbmNlIHdoZW4gdGhlIE5leHQuanMgc2VydmVyIHN0YXJ0cy5cbi8vIFdlIHVzZSBpdCB0byBpbml0aWFsaXplIHRoZSBLYWZrYSBjb25zdW1lciBzbyBpdCBydW5zIGluIHRoZSBzYW1lXG4vLyBwcm9jZXNzIGFzIHRoZSBOZXh0LmpzIHNlcnZlciwgc2hhcmluZyBtZW1vcnkgd2l0aCBTU0UgY29ubmVjdGlvbnMuXG4vL1xuLy8gRG9jdW1lbnRhdGlvbjogaHR0cHM6Ly9uZXh0anMub3JnL2RvY3MvYXBwL2J1aWxkaW5nLXlvdXItYXBwbGljYXRpb24vb3B0aW1pemluZy9pbnN0cnVtZW50YXRpb25cbi8vXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWdpc3RlcigpIHtcbiAgY29uc29sZS5sb2coJ1tJbnN0cnVtZW50YXRpb25dIFJlZ2lzdGVyIGNhbGxlZCwgcnVudGltZTonLCBwcm9jZXNzLmVudi5ORVhUX1JVTlRJTUUsICdQSUQ6JywgcHJvY2Vzcy5waWQpO1xuICBcbiAgLy8gT25seSBydW4gb24gdGhlIHNlcnZlciAobm90IGluIGVkZ2UgcnVudGltZSBvciBjbGllbnQpXG4gIC8vIEluIGRldmVsb3BtZW50LCB0aGlzIHJ1bnMgaW4gdGhlIE5vZGUuanMgcnVudGltZVxuICBpZiAocHJvY2Vzcy5lbnYuTkVYVF9SVU5USU1FID09PSAnbm9kZWpzJyB8fCAhcHJvY2Vzcy5lbnYuTkVYVF9SVU5USU1FKSB7XG4gICAgY29uc29sZS5sb2coJ1tJbnN0cnVtZW50YXRpb25dIEluaXRpYWxpemluZyBLYWZrYSBjb25zdW1lci4uLicpO1xuICAgIFxuICAgIHRyeSB7XG4gICAgICAvLyBEeW5hbWljYWxseSBpbXBvcnQgdG8gYXZvaWQgYnVuZGxpbmcgaXNzdWVzXG4gICAgICBjb25zdCB7IHN0YXJ0Q29uc3VtZXIgfSA9IGF3YWl0IGltcG9ydCgnQC9saWIva2Fma2EvY29uc3VtZXInKTtcbiAgICAgIFxuICAgICAgLy8gU3RhcnQgdGhlIGNvbnN1bWVyXG4gICAgICBhd2FpdCBzdGFydENvbnN1bWVyKCk7XG4gICAgICBcbiAgICAgIGNvbnNvbGUubG9nKCdbSW5zdHJ1bWVudGF0aW9uXSDinJMgS2Fma2EgY29uc3VtZXIgc3RhcnRlZCBzdWNjZXNzZnVsbHknKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignW0luc3RydW1lbnRhdGlvbl0g4pyXIEZhaWxlZCB0byBzdGFydCBLYWZrYSBjb25zdW1lcjonLCBlcnJvcik7XG4gICAgICAvLyBEb24ndCBjcmFzaCB0aGUgc2VydmVyIGlmIEthZmthIGlzIHVuYXZhaWxhYmxlXG4gICAgICAvLyBUaGUgYXBwIGNhbiBzdGlsbCBmdW5jdGlvbiB3aXRob3V0IHJlYWwtdGltZSB1cGRhdGVzXG4gICAgICBjb25zb2xlLndhcm4oJ1tJbnN0cnVtZW50YXRpb25dIFNlcnZlciB3aWxsIGNvbnRpbnVlIHdpdGhvdXQgcmVhbC10aW1lIEthZmthIHVwZGF0ZXMnKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgY29uc29sZS5sb2coJ1tJbnN0cnVtZW50YXRpb25dIFNraXBwaW5nIEthZmthIGNvbnN1bWVyIChub3QgaW4gbm9kZWpzIHJ1bnRpbWUpLCBQSUQ6JywgcHJvY2Vzcy5waWQpO1xuICB9XG59XG5cbiJdLCJuYW1lcyI6WyJyZWdpc3RlciIsImNvbnNvbGUiLCJsb2ciLCJwcm9jZXNzIiwiZW52IiwiTkVYVF9SVU5USU1FIiwicGlkIiwic3RhcnRDb25zdW1lciIsImVycm9yIiwid2FybiJdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(instrument)/./src/instrumentation.ts\n");

/***/ })

};
;

// load runtime
var __webpack_require__ = require("./webpack-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = (__webpack_exec__("(instrument)/./src/instrumentation.ts"));
module.exports = __webpack_exports__;

})();