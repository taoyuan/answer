(function (define, global) {
    'use strict';
    define(function () {

        answer.promise = promise;
        answer.resolve = resolve;
        answer.reject = reject;
        answer.defer = defer;

        answer.isPromise = isPromise;

        /**
         * Register an observer for a promise or immediate value.
         *
         * @param {*} promiseOrValue
         * @param {function?} [onFulfilled] callback to be called when promiseOrValue is
         *   successfully fulfilled.  If promiseOrValue is an immediate value, callback
         *   will be invoked immediately.
         * @param {function?} [onRejected] callback to be called when promiseOrValue is
         *   rejected.
         * @param {function?} [onProgress] callback to be called when progress updates
         *   are issued for promiseOrValue.
         * @returns {Promise} a new {@link Promise} that will complete with the return
         *   value of callback or errback or the completion value of promiseOrValue if
         *   callback and/or errback is not supplied.
         */
        function answer(promiseOrValue, onFulfilled, onRejected, onProgress) {
            // Get a trusted promise for the input promiseOrValue, and then
            // register promise handlers
            var promise = resolve(promiseOrValue);
            if (arguments.length > 1) {
                promise = promise.then(onFulfilled, onRejected, onProgress);
            }
            return promise;
        }



        /**
         * Trusted Promise constructor.  A Promise created from this constructor is
         * a trusted answer.js promise.  Any other duck-typed promise is considered
         * untrusted.
         * @constructor
         * @name Promise
         */
        function Promise() {

        }

        Promise.prototype = {

        };

        /**
         * Returns a resolved promise. The returned promise will be
         *  - fulfilled with promiseOrValue if it is a value, or
         *  - if promiseOrValue is a promise
         *    - fulfilled with promiseOrValue's value after it is fulfilled
         *    - rejected with promiseOrValue's reason after it is rejected
         * @param  {*} value
         * @return {Promise}
         */
        function resolve(value) {
            return promise(function (resolve) {
                resolve(value);
            });
        }

        /**
         * Returns a rejected promise for the supplied promiseOrValue.  The returned
         * promise will be rejected with:
         * - promiseOrValue, if it is a value, or
         * - if promiseOrValue is a promise
         *   - promiseOrValue's value after it is fulfilled
         *   - promiseOrValue's reason after it is rejected
         * @param {*} promiseOrValue the rejected value of the returned {@link Promise}
         * @return {Promise} rejected {@link Promise}
         */
        function reject(promiseOrValue) {
            return promise(function (resolve, reject) {
                reject(promiseOrValue);
            });
        }


        function defer() {
            var deferred, pending, resolved;

            deferred = {
                promise: undef, resolve: undef, reject: undef, notify: undef,
                resolver: { resolve: undef, reject: undef, notify: undef }
            };

            deferred.promise = pending = promise(makeDeferred);

            return deferred;

            function makeDeferred(resolvePending, rejectPending, notifyPending) {
                deferred.resolve = deferred.resolver.resolve = function (value) {
                    if (resolved) {
                        return resolve(value);
                    }
                    resolved = true;
                    resolvePending(value);
                    return pending;
                };

                deferred.reject = deferred.resolver.reject = function (reason) {
                    if (resolved) {
                        return reject(reason);
                    }
                    resolved = true;
                    rejectPending(reason);
                    return pending;
                };

                deferred.notify = deferred.resolver.notify = function (update) {
                    notifyPending(update);
                    return update;
                };
            }

        }

        function promise(resolver) {
            var self, consumers = [],  method, value;

            self = new Promise();
            self.then = then;
            self.done = self.end = done;

            resolver(promiseResolve, promiseReject, promiseNotify);

            return self;

            function schedule(handlers, resolvers) {
                consumers ? consumers.push(invoke) : enqueue(function() { invoke(method, value); });

                function invoke(h, v) {
                    var fn, r = v;
                    // Invoke handlers
                    if ((fn = handlers[h]) && (typeof fn === 'function')) {
                        r = fn(v);
                    }
                    // Invoke sub promise resolvers
                    if (resolvers && (fn = resolvers[h])) {
                        fn(r);
                    }
                }
            }

            /**
             * Register handlers for this promise and return new promise.
             * @param [onFulfilled] {Function} fulfillment handler
             * @param [onRejected] {Function} rejection handler
             * @param [onProgress] {Function} progress handler
             * @return {Promise} new Promise
             */
            function then(onFulfilled, onRejected, onProgress) {
                /*jshint unused:false*/
                var args = arguments;
                return promise(function (resolve, reject, notify) {
                    schedule(args, [resolve, reject, notify]);
                });
            }

            /**
             * Register handlers for this promise without return promise.
             * @param [onFulfilled] {Function} fulfillment handler
             * @param [onRejected] {Function} rejection handler
             * @param [onProgress] {Function} progress handler
             */
            function done(onFulfilled, onRejected, onProgress) {
                /*jshint unused:false*/
                schedule(arguments);
            }

            function promiseResolve(value) {
                invokeConsumers(0, value);
            }

            function promiseReject(reason) {
                invokeConsumers(1, reason);
            }

            function promiseNotify(update) {
                if (consumers) {
                    scheduleConsumers(consumers, 2, update);
                }
            }

            function invokeConsumers(mtd, val) {
                if (!consumers) return;

                if (isPromise(val)) {
                    val.then(promiseResolve, promiseReject, promiseNotify);
                    return;
                }

                scheduleConsumers(consumers, mtd, val);
                consumers = undef;
                method = mtd;
                value = val;
            }
        }

        /**
         * Schedule a task that will process a list of handlers
         * in the next queue drain run.
         * @private
         * @param {Array} handlers queue of handlers to execute
         * @param {Number} method
         * @param {*} value
         */
        function scheduleConsumers(handlers, method, value) {
            enqueue(function() {
                var handler, i = 0;
                while (handler = handlers[i++]) {
                    handler(method, value);
                }
            });
        }

        /**
         * Determines if promiseOrValue is a promise or not
         *
         * @param {*} promiseOrValue anything
         * @returns {boolean} true if promiseOrValue is a {@link Promise}
         */
        function isPromise(promiseOrValue) {
            return promiseOrValue && typeof promiseOrValue.then === 'function';
        }


        // Internals, utilities, etc.

        var nextTick, handlerQueue, undef;


        //
        // Shared handler queue processing
        //
        // Credit to Twisol (https://github.com/Twisol) for suggesting
        // this type of extensible queue + trampoline approach for
        // next-tick conflation.

        handlerQueue = [];

        /**
         * Enqueue a task. If the queue is not currently scheduled to be
         * drained, schedule it.
         * @param {function} task
         */
        function enqueue(task) {
            if(handlerQueue.push(task) === 1) {
                nextTick(drainQueue);
            }
        }

        /**
         * Drain the handler queue entirely, being careful to allow the
         * queue to be extended while it is being processed, and to continue
         * processing until it is truly empty.
         */
        function drainQueue() {
            var task, i = 0;

            while(task = handlerQueue[i++]) {
                task();
            }

            handlerQueue = [];
        }


        // Prefer setImmediate or MessageChannel, cascade to node,
        // vertx and finally setTimeout
        /*global setImmediate,MessageChannel,process,vertx*/
        if (typeof setImmediate === 'function') {
            nextTick = setImmediate.bind(global);
        } else if(typeof MessageChannel !== 'undefined') {
            var channel = new MessageChannel();
            channel.port1.onmessage = drainQueue;
            nextTick = function() { channel.port2.postMessage(0); };
        } else if (typeof process === 'object' && process.nextTick) {
            nextTick = process.nextTick;
        } else if (typeof vertx === 'object') {
            nextTick = vertx.runOnLoop;
        } else {
            nextTick = function(t) { setTimeout(t, 0); };
        }


        return answer;
    });
})(typeof define === 'function' && define.amd ? define : function (factory) { module.exports = factory(); }, this);
