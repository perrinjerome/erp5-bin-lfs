/*global window, rJS, RSVP, document, loopEventListener, console */
/*jslint nomen: true, indent: 2, maxerr: 30 */
(function (window, rJS, RSVP, document, loopEventListener, console) {
  "use strict";

  rJS(window)

    .ready(function (gadget) {
      gadget.property_dict = {};
    })

    .declareMethod("render", function (options) {
      return this.changeState(options);
    })

    .onStateChange(function () {
      var gadget = this;
      gadget.property_dict.deferred = RSVP.defer();

      return gadget.getDeclaredGadget('jsmd_eval')
        .push(function (eval_gadget) {
          var loading_spinner = document.createElement("div");
          loading_spinner.setAttribute('id', 'js-spinner');
          loading_spinner.classList.add("nb-ui-icon-spinner");
          loading_spinner.classList.add("nb-ui-btn-icon-notext");
          loading_spinner.classList.add("nb-loader");
          loading_spinner.innerHTML = "Loading notebook...";
          gadget.element.prepend(loading_spinner);
          return eval_gadget.render({'jsmd_code' : gadget.state.value});
        })
        .push(function () {
          gadget.listenResize();
          console.log("JSMD Eval Done.");
          document.querySelector('[id="js-spinner"]').remove();
          return gadget.property_dict.deferred.resolve();
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

}(window, rJS, RSVP, document, loopEventListener, console));