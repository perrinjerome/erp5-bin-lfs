/*global window, document, rJS, RSVP, XMLHttpRequest, WebAssembly, loadSharedlib, marked, console */
/*jslint nomen: true, indent: 2, maxerr: 3 */
(function (window, document, rJS, RSVP, XMLHttpRequest, WebAssembly, loadSharedlib, marked, console) {
  "use strict";

  var IODide = function createIODide() {
    return;
  },
    JSMDCell = function createJSMDCell(type, line_list, option) {
      this._type = type;
      this._line_list = line_list;
      this._option = option;
    },
    is_pyodide_loaded = false,
    pyodide_instance,
    split_line_regex = /[\r\n|\n|\r]/,
    cell_type_regexp = /^\%\% (\w+)/;

  window.iodide = new IODide();

  IODide.prototype.addOutputHandler = function () {
    return;
  };

  // Copied from jio
  function ajax(param) {
    var xhr = new XMLHttpRequest();
    return new RSVP.Promise(function (resolve, reject) {
      var k;
      xhr.open(param.type || "GET", param.url, true);
      xhr.responseType = param.dataType || "";
      if (typeof param.headers === 'object' && param.headers !== null) {
        for (k in param.headers) {
          if (param.headers.hasOwnProperty(k)) {
            xhr.setRequestHeader(k, param.headers[k]);
          }
        }
      }
      xhr.addEventListener("load", function (e) {
        if (e.target.status >= 400) {
          return reject(e);
        }
        resolve(e);
      });
      xhr.addEventListener("error", reject);
      if (typeof param.xhrFields === 'object' && param.xhrFields !== null) {
        for (k in param.xhrFields) {
          if (param.xhrFields.hasOwnProperty(k)) {
            xhr[k] = param.xhrFields[k];
          }
        }
      }
      if (param.timeout !== undefined && param.timeout !== 0) {
        xhr.timeout = param.timeout;
        xhr.ontimeout = function () {
          return reject(new Error("Gateway Timeout"));
        };
      }
      if (typeof param.beforeSend === 'function') {
        param.beforeSend(xhr);
      }
      xhr.send(param.data);
    }, function () {
      xhr.abort();
    });
  }

  function loadJSResource(url) {
    // Copied from renderJS
    return new RSVP.Promise(
      function waitForJSLoadEvent(resolve, reject) {
        var newScript;
        newScript = document.createElement('script');
        newScript.async = false;
        newScript.type = 'text/javascript';
        newScript.onload = function (evt) {
          resolve(evt.target.value);
        };
        newScript.onerror = function (error) {
          console.warn(error);
          reject(error);
        };
        newScript.src = url;
        document.head.appendChild(newScript);
      }
    );
  }

  function loadPyodide(imports, success_callback) {
    return new RSVP.Queue()
      .push(function () {
        return ajax({
          url: "pyodide.asm.wasm",
          dataType: "arraybuffer"
        });
      })
      .push(function (evt) {
        // Compile and instantiate WebAssembly code.
        // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/instantiate
        return WebAssembly.instantiate(evt.target.response, imports);
      })
      .push(function (result) {
        // This function act as instantiateWasm
        // And in instantiateWasm, we have to call the second parameter
        // See https://emscripten.org/docs/api_reference/module.html#Module.instantiateWasm
        return success_callback(result.instance);
      });
  }

  function checkABI(ABI_number) {
    // This was needed by pyodide wasm module
    if (ABI_number !== 1) {
      throw new Error("Expect ABI number 1, got " + ABI_number);
    }
    return true;
  }

  // Pyodide package loading
  function pyodideLoadPackage(names) {
    var queue, toLoad, package_name, k,
      subpackage, packages, loadedPackages, defer;
    packages = pyodide_instance.packages.dependencies;
    loadedPackages = pyodide_instance.loadedPackages;
    // packages is dependency list of each package
    // e.g.: [pandas: ['numpy', 'python-dateutil', 'pytz'], numpy: []]
    queue = new Array(names);

    toLoad = [];
    defer = RSVP.defer();
    // Find all packages that need to load, store in the "toLoad" list
    while (queue.length) {
      package_name = queue.pop();

      if (loadedPackages.indexOf(package_name) === -1) {
        toLoad.push(package_name);
        // packages is the dependency list
        if (packages.hasOwnProperty(package_name)) {
          for (k = 0; k < packages[package_name].length; k += 1) {
            subpackage = packages[package_name][k];
            if (loadedPackages.indexOf(subpackage) === -1 && toLoad.indexOf(subpackage) === -1) {
              queue.push(subpackage);
            }
          }
        } else {
          throw new Error("Unknown package " + package_name);
        }
      }
    }

    if (toLoad.length === 0) {
      // No new packages to load
      return;
    }

    // pyodide built with option "--use-preload-plugins"
    // So emscripten load the pyodide itself and its extension using createPreloadedFile.
    // See createPreloadedFile section in:
    // https://github.com/emscripten-core/emscripten/blob/master/site/source/docs/api_reference/Filesystem-API.rst

    // And createPreloadedFile use addRunDependency or removeRunDependency to handle the dependencies,
    // it will call monitorRunDependencies.
    // https://github.com/emscripten-core/emscripten/blob/master/src/preamble.js#L1842

    // The logic in here is if we loaded all wasm module, aka the "left" is 0.
    // We load all shared lib to the wasm file system through loadSharedlib.

    pyodide_instance.monitorRunDependencies = function (left) {
      if (left === 0) {
        for (k = 0; k < toLoad.length; k += 1) {
          package_name = toLoad[k];
          loadedPackages.push(package_name);
        }
        delete pyodide_instance.monitorRunDependencies;
        return loadSharedlib(pyodide_instance._module.FS)
          .push(function () {
            defer.resolve();
            return;
          });
      }
    };

    for (k = 0; k < toLoad.length; k += 1) {
      package_name = toLoad[k];
      loadJSResource(package_name + ".js");
    }

    pyodide_instance.runPython('import importlib as _importlib\n' +
      '_importlib.invalidate_caches()\n');
    return defer.promise;
  }

  function initPyodide() {
    var Module = {};

    // perform the WebAssembly instantiation action
    // See https://emscripten.org/docs/api_reference/module.html#Module.instantiateWasm
    Module.instantiateWasm = loadPyodide;
    Module.checkABI = checkABI;
    window.Module = Module;

    return RSVP.Queue()
      .push(function () {
        return loadJSResource('pyodide.asm.data.js');
      })
      .push(function () {
        return loadJSResource('pyodide.asm.js');
      })
      .push(function () {
        // pyodide is a function defined in pyodide.asm.js
        // which set the functions under Module
        pyodide_instance = window.pyodide(Module);
        var defer = RSVP.defer();
        // define postRun to resolve the promise
        // When pyodide loading completed, it will call Module.postRun
        // to signal the module loaded and ready for next step
        // https://github.com/emscripten-core/emscripten/blob/1.38.10/src/preamble.js#L1602
        // https://emscripten.org/docs/api_reference/preamble.js.html
        Module.postRun = defer.resolve;
        return defer.promise;
      })
      .push(function () {
        return ajax({
          url: 'packages.json'
        });
      })
      .push(function (evt) {
        return JSON.parse(evt.target.response);
      })
      .push(function (json) {
        pyodide_instance._module = Module;
        pyodide_instance.loadedPackages = [];
        pyodide_instance._module.packages = json;
        // Make pyodide happy...
        // pyodide.asm.js need window.pyodide:
        // https://github.com/iodide-project/pyodide/blob/master/src/runpython.c#L91
        // var packageNames = self.pyodide._module.packages.import_name_to_package_name;
        // import_name_to_package_name was defined when reading package.json
        // https://github.com/iodide-project/pyodide/blob/master/pyodide_build/buildall.py#L58
        window.pyodide = pyodide_instance;
        window.pyodide.loadPackage = pyodideLoadPackage;
        return;
      });
  }

  function parseJSMDCellList(jsmd) {
    // Split the text into a list of Iodide cells
    var line_list = jsmd.split(split_line_regex),
      i,
      len = line_list.length,
      current_line,
      current_type,
      current_header,
      current_text_list,
      option,
      next_type,
      cell_list = [];

    function pushNewCell() {
      if (current_type !== undefined) {
        option = current_header.slice(current_type[0].length);
        if (option === '') {
          option = '{}';
        }
        option = JSON.parse(option);

        cell_list.push(new JSMDCell(current_type[1],
                                      current_text_list, option));
      }
    }

    for (i = 0; i < len; i += 1) {
      current_line = line_list[i];
      next_type = current_line.match(cell_type_regexp);
      if (next_type) {
        // New type detected
        pushNewCell();
        current_type = next_type;
        current_header = current_line;
        current_text_list = [];
      } else if (current_text_list !== undefined) {
        current_text_list.push(current_line);
      }
    }
    // Push last cell
    pushNewCell();
    return cell_list;
  }

  function executeUnknownCellType(cell) {
    throw new Error('Unsupported cell: ' + cell._type);
  }

  function executeJSCell(line_list) {
    // console.info('eval', line_list);
    var text = line_list.join('\n'),
      pre,
      br,
      code;
    try {
      // In order to load Python package,
      // we have to initialize pyodide first
      if (text.includes('loadPackage') && !is_pyodide_loaded) {
        is_pyodide_loaded = true;
        return initPyodide()
          .push(function () {
            return eval.call(window, text);
          });
      }
      return eval.call(window, text);
    } catch (e) {
      console.error(e);
      pre = document.createElement('pre');
      pre.textContent = e.message;

      br = document.createElement('br');
      pre.appendChild(br);

      code = document.createElement('code');
      code.textContent = text;
      pre.appendChild(code);
      document.body.appendChild(pre);
      throw e;
    }
  }

  function executeCssCell(line_list) {
    var style = document.createElement('style');
    style.textContent = line_list.join('\n');
    document.head.appendChild(style);
  }

  function deferJSResourceLoading(url) {
    return function () {
      return loadJSResource(url);
    };
  }

  function loadCSSResource(url) {
    // Copied from renderJS
    return new RSVP.Promise(
      function waitForCSSLoadEvent(resolve, reject) {
        var link;
        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.type = 'text/css';
        link.href = url;
        link.onload = resolve;
        link.onerror = reject;
        document.head.appendChild(link);
      }
    );
  }

  function deferCSSResourceLoading(url) {
    return function () {
      return loadCSSResource(url);
    };
  }

  function loadTextResource(line) {
    var line_split = line.split('=', 2),
      variable = line_split[0],
      url = line_split[1];
    console.log(line_split);
    return new RSVP.Queue()
      .push(function () {
        return ajax({url: url});
      })
      .push(function (evt) {
        window[variable] = evt.target.responseText;
      });
  }

  function deferTextResourceLoading(line) {
    return function () {
      return loadTextResource(line);
    };
  }

  function executeResourceCell(line_list) {
    var queue = new RSVP.Queue(),
      len = line_list.length,
      i;
    for (i = 0; i < len; i += 1) {
      if (line_list[i]) {
        queue.push(deferJSResourceLoading(line_list[i]));
      }
    }
    return queue;
  }

  function executeFetchCell(line_list) {
    var queue = new RSVP.Queue(),
      len = line_list.length,
      i,
      line;
    for (i = 0; i < len; i += 1) {
      line = line_list[i];
      if (line) {
        if (line.startsWith('js: ')) {
          queue.push(deferJSResourceLoading(line.slice(4)));
        } else if (line.startsWith('css: ')) {
          queue.push(deferCSSResourceLoading(line.slice(5)));
        } else if (line.startsWith('text: ')) {
          queue.push(deferTextResourceLoading(line.slice(6)));
        } else {
          queue.cancel();
          throw new Error('Unsupported fetch type: ' + line);
        }
      }
    }
    return queue;
  }

  function executeMarkdownCell(line_list) {
    var renderer = new marked.Renderer();
    return new RSVP.Promise(function (resolve, reject) {
      marked(line_list.join('\n'),
             {renderer: renderer},
             function (err, content) {
          if (err) {
            reject(err);
          }
          var div = document.createElement('div');
          div.classList.add('user-markdown');
          div.innerHTML = content;
          document.body.appendChild(div);
          resolve();
        });
    });
  }

  function renderCodeblock(result_text) {
    var div = document.createElement('div'),
      pre = document.createElement('pre'),
      result = document.createElement('code');
    div.classList.add('code-block');

    if (result_text !== undefined) {
      result.innerHTML = result_text;
      pre.appendChild(result);
      div.appendChild(pre);
      document.body.appendChild(div);
    }
  }

  function outputElement(node_type) {
    var div, node;
    div = document.createElement("div");
    // iodide.output.element API allows user to define the node type
    node = document.createElement(node_type);
    div.append(node);
    document.body.appendChild(div);
    // div for insert in to the body
    // node for return to the caller
    return node;
  }

  // We provided window.pyodide, so matplotlib will use iodide.output.element as backend
  // see: https://github.com/iodide-project/pyodide/blob/master/packages/matplotlib/src/wasm_backend.py#L108
  // It is not related to addOutputHandler
  window.iodide.output = {element: outputElement};

  function executePyCell(line_list) {
    var result, code_text = line_list.join('\n');
    result = pyodide_instance.runPython(code_text);
    renderCodeblock(result);
  }

  function executeCodeCell(line_list, option) {
    if (option.language !== 'py') {
      throw new Error('Unsupported code language: ' + option.language);
    }

    if (!is_pyodide_loaded) {
      is_pyodide_loaded = true;
      return initPyodide()
        .push(function () {
          return executePyCell(line_list);
        })
        .push(function () {
          return pyodideLoadPackage('matplotlib');
        });
    }
    return executePyCell(line_list);
  }

  function executeCell(cell) {
    if (cell._type === 'raw' || cell._type === 'meta' || cell._type === 'plugin') {
      // Do nothing...
      return;
    }
    // The block "%% code" is for keep the compatibility with the legacy pyodide notebook
    // New notebook suggest to use "%% py" directly
    if (cell._type === 'code') {
      return executeCodeCell(cell._line_list, cell._option);
    }
    if (cell._type === 'js') {
      return executeJSCell(cell._line_list);
    }
    if (cell._type === 'py') {
      return executeCodeCell(cell._line_list, {language: 'py'});
    }
    if (cell._type === 'resource') {
      return executeResourceCell(cell._line_list);
    }
    if (cell._type === 'fetch') {
      return executeFetchCell(cell._line_list);
    }
    if (cell._type === 'md') {
      return executeMarkdownCell(cell._line_list);
    }
    if (cell._type === 'css') {
      return executeCssCell(cell._line_list);
    }
    return executeUnknownCellType(cell);
  }

  function deferCellExecution(cell) {
    return function () {
      return new RSVP.Queue()
        .push(function () {
          return executeCell(cell);
        })
        .push(undefined, function (error) {
          //errors in cell execution must be part of the notebook result
          //notebook execution must continue
          var pre = document.createElement('pre');
          pre.textContent = error;
          document.body.appendChild(pre);
        });
    };
  }

  rJS(window)

    .declareMethod("render", function (options) {
      return this.changeState(options);
    })

    .onStateChange(function (options) {
      var gadget = this,
        jsmd = options.jsmd_code,
        cell_list = parseJSMDCellList(jsmd),
        len = cell_list.length,
        i,
        queue = new RSVP.Queue();
      for (i = 0; i < len; i += 1) {
        queue.push(deferCellExecution(cell_list[i]));
      }
      return queue
        .push(function () {
          console.info('JSMD executed.');
        }, function (error) {
          console.error(error);
          var pre = document.createElement('pre');
          pre.textContent = error;
          document.body.appendChild(pre);
        });
    });

}(window, document, rJS, RSVP, XMLHttpRequest, WebAssembly, loadSharedlib, marked, console));