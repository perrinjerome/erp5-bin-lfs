/*global window, console, document, RSVP */
/*jslint nomen: true, indent: 2, maxerr: 3 */

//  The code within this file is copied from iodide/pyodide project with modification,
//  which subject to the terms of the Mozilla Public License, v. 2.0.
//  If a copy of the MPL was not distributed with this file,
//  You can obtain one at http://mozilla.org/MPL/2.0/.

function loadSharedlib(file_system) {
  "use strict";
  // On Chrome, we have to instantiate wasm asynchronously. Since that
  // can't be done synchronously within the call to dlopen, we instantiate
  // every .so that comes our way up front, caching it in the
  // `preloadedWasm` dictionary.
  var queue, path;
  queue = new RSVP.Queue();

  function recurseDir(rootpath) {
    var i, entry, dirs;
    try {
      dirs = file_system.readdir(rootpath);
    } catch (e) {
      if (e instanceof file_system.ErrnoError) {
        return;
      }
      throw e;
    }

    function readModuleFile(path) {
      return function () {
        return window.Module.loadWebAssemblyModule(
          file_system.readFile(path),
          {loadAsync: true}
        );
      };
    }
    function setModule(path) {
      return function (module) {
        window.Module.preloadedWasm[path] = module;
      };
    }

    for (i = 0; i < dirs.length; i += 1) {
      entry = dirs[i];
      if (!entry.startsWith('.')) {
        path = rootpath + entry;

        if (entry.endsWith('.so')) {
          if (window.Module.preloadedWasm[path] === undefined) {
            queue.push(readModuleFile(path))
              .push(setModule(path));
          }
        } else if (file_system.isDir(file_system.lookupPath(path).node.mode)) {
          recurseDir(path + '/');
        }
      }
    }
  }

  recurseDir('/');

  return queue;
}