/*global window, rJS, console, RSVP, jIO, DOMParser, Blob, document,
         URL, loopEventListener */
/*jslint nomen: true, indent: 2, maxerr: 3 */
(function (window, rJS, RSVP, jIO, DOMParser, document, URL,
           loopEventListener) {
  "use strict";

  function fetchHTML(url, base_url) {
    url = new URL(url, base_url).href;
    return new RSVP.Queue()
      .push(function () {
        return jIO.util.ajax({url: url});
      })
      .push(function (evt) {
        // Insert a "base" element, in order to resolve all relative links
        // which could get broken with a data url
        var doc = (new DOMParser()).parseFromString(evt.target.responseText,
                                                    'text/html'),
          base = doc.createElement('base');
        base.href = url;
        doc.head.insertBefore(base, doc.head.firstChild);
        return doc;
      });
  }

  rJS(window)

    .ready(function (gadget) {
      gadget.property_dict = {};
    })
    /////////////////////////////////////////////////////////////////
    // declared methods
    /////////////////////////////////////////////////////////////////

    .declareMethod("render", function (options) {
      return this.changeState(options);
    })

    .onStateChange(function () {
      // Reset everything if something change

      var gadget = this,
        base_url = document.location.toString(),
        doc;
      gadget.property_dict.deferred = RSVP.defer();

      return fetchHTML("gadget_jsmd_eval.html", base_url)
        .push(function (result) {
          doc = result;
          // Insert text
          doc.body.textContent = '';

          // Insert the JSMD value inside the HTML
          var script = document.createElement('script'),
            iframe = document.createElement("iframe"),
            loading_spinner = document.createElement("div");

          script.setAttribute('type', 'text/x-jsmd');
          script.setAttribute('id', 'jsmd-source');
          script.textContent = gadget.state.value;
          doc.head.appendChild(script);

          loading_spinner.setAttribute('id', 'js-spinner');
          loading_spinner.classList.add("nb-ui-icon-spinner");
          loading_spinner.classList.add("nb-ui-btn-icon-notext");
          loading_spinner.classList.add("nb-loader");
          loading_spinner.innerHTML = "Loading notebook...";

/*
          blob = new Blob([doc.documentElement.outerHTML],
                          {type: "text/html;charset=UTF-8"});
          return jIO.util.readBlobAsDataURL(blob);
        })
        .push(function (evt) {
*/
          // XXX Insecure
          iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
          // iframe.setAttribute("csp", "default-src *; script-src * 'unsafe-inline';");
          // iframe.setAttribute("src", evt.target.result);
          iframe.setAttribute('id', 'jsmd_eval_notebook');
          iframe.setAttribute('name', 'jsmd_eval_notebook');
          iframe.setAttribute("srcdoc", doc.documentElement.outerHTML);
          gadget.element.innerHTML = iframe.outerHTML;
          gadget.element.prepend(loading_spinner);
          gadget.listenResize();
          gadget.listenMessage();
        });
    })

    .declareMethod('getContent', function () {
      var gadget = this,
        content_dict = {},
        dict = gadget.property_dict;
      return new RSVP.Queue()
        .push(function () {
          return dict.deferred.promise;
        })
        .push(function () {
          content_dict[gadget.state.key] = gadget.element.querySelector("iframe")
            .contentDocument.firstChild.innerHTML;
          return content_dict;
        });
    })

    .declareJob('listenMessage', function () {
      var gadget = this,
        dict = gadget.property_dict;
      return loopEventListener(window, 'message', false, function (event) {
          //only handle jsmd eval child messages
          if ((event.origin !== window.origin) || (event.data !== "jsmd_eval_done"))
            return;
          console.log("JSMD Eval Done.");
          document.querySelector('[id="js-spinner"]').remove();
          return dict.deferred.resolve();
        }
      );
    })

    .declareJob('listenResize', function () {
      var gadget = this;
      function resize() {
        gadget.element.querySelector("iframe").style.height =
          (window.innerHeight -
             gadget.element.querySelector("iframe").offsetTop) + "px";
      }
      resize();
      return loopEventListener(window, 'resize', false, resize);
    });

}(window, rJS, RSVP, jIO, DOMParser, document, URL, loopEventListener));