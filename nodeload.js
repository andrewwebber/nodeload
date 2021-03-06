#!/usr/bin/env node
// -----------------------------------------
// Header for single file build 
// -----------------------------------------

var util = require('util'),
    http = require('http'),
    url = require('url'),
    fs = require('fs'),
    path = require('path'),
    events = require('events'),
    querystring = require('querystring'),
    child_process = require('child_process');

var EventEmitter = events.EventEmitter;

var START = new Date();
var BUILD_AS_SINGLE_FILE = true;
// ------------------------------------
// Nodeload configuration
// ------------------------------------
//
// The functions in this file control the behavior of the nodeload globals, like HTTP_SERVER and 
// REPORT_MANAGER. They should be called when the library is included:
//
//      var nl = require('./lib/nodeload').quiet().usePort(10000);
//      nl.runTest(...);
//
// Or, when using individual modules:
//
//      var nlconfig = require('./lib/config').quiet().usePort(10000);
//      var reporting = require('./lib/reporting');
//
var BUILD_AS_SINGLE_FILE, NODELOAD_CONFIG;
if (!BUILD_AS_SINGLE_FILE) {
var EventEmitter = require('events').EventEmitter;
}

/** Suppress all console output */
exports.quiet = function() {
    NODELOAD_CONFIG.QUIET = true;
    return exports;
};

/** Start the nodeload HTTP server on the given port */
exports.usePort = function(port) {
    NODELOAD_CONFIG.HTTP_PORT = port;
    return exports;
};

/** Do not start the nodeload HTTP server */
exports.disableServer = function() {
    NODELOAD_CONFIG.HTTP_ENABLED = false;
    return exports;
};

/** Set the default number of milliseconds between 'update' events from a LoadTest created by run(). */
exports.setMonitorIntervalMs = function(milliseconds) {
    NODELOAD_CONFIG.MONITOR_INTERVAL_MS = milliseconds;
    return exports;
};

/** Set the number of milliseconds between auto-refreshes for the summary webpage */
exports.setAjaxRefreshIntervalMs = function(milliseconds) {
    NODELOAD_CONFIG.AJAX_REFRESH_INTERVAL_MS = milliseconds;
    return exports;
};

/** Do not write any logs to disk */
exports.disableLogs = function() {
    NODELOAD_CONFIG.LOGS_ENABLED = false;
    return exports;
};

/** Set the number of milliseconds between pinging slaves when running distributed load tests */
exports.setSlaveUpdateIntervalMs = function(milliseconds) {
    NODELOAD_CONFIG.SLAVE_UPDATE_INTERVAL_MS = milliseconds;
};

// =================
// Singletons
// =================

var NODELOAD_CONFIG = exports.NODELOAD_CONFIG = {
    START: new Date(),

    QUIET: Boolean(process.env.QUIET) || false,

    HTTP_ENABLED: true,
    HTTP_PORT: Number(process.env.HTTP_PORT) || 8000,

    MONITOR_INTERVAL_MS: 2000,

    AJAX_REFRESH_INTERVAL_MS: 2000,

    LOGS_ENABLED: process.env.LOGS ? process.env.LOGS !== '0' : true,
    
    SLAVE_UPDATE_INTERVAL_MS: 3000,
    
    eventEmitter: new EventEmitter(),
    on: function(event, fun) {
        this.eventEmitter.on(event, fun);
    },
    apply: function() {
        this.eventEmitter.emit('apply');
    }
};

process.nextTick(function() { NODELOAD_CONFIG.apply(); });// ------------------------------------
// Statistics Manager
// ------------------------------------
//
// This file defines qputs, qprint, and extends the util namespace.
//
// Extends node.js util.js with other common functions.
//
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var NODELOAD_CONFIG = require('./config').NODELOAD_CONFIG;
}

// A few common global functions so we can access them with as few keystrokes as possible
//
var qputs = util.qputs = function(s) {
    if (!NODELOAD_CONFIG.QUIET) { util.puts(s); }
};

var qprint = util.qprint = function(s) {
    if (!NODELOAD_CONFIG.QUIET) { util.print(s); }
};


// Static utility methods
//
util.uid = function() {
    exports.lastUid_ = exports.lastUid_ || 0;
    return exports.lastUid_++;
};
util.defaults = function(obj, defaults) {
    for (var i in defaults) {
        if (obj[i] === undefined) {
            obj[i] = defaults[i];
        }
    }
    return obj;
};
util.extend = function(obj, extension) {
    for (var i in extension) {
        if (extension.hasOwnProperty(i)) {
            obj[i] = extension[i];
        }
    }
    return obj;
};
util.forEach = function(obj, f) {
    for (var i in obj) {
        if (obj.hasOwnProperty(i)) {
            f(i, obj[i]);
        }
    }
};
util.every = function(obj, f) {
    for (var i in obj) {
        if (obj.hasOwnProperty(i)) {
            if (!f(i, obj[i])) {
                return false;
            }
        }
    }
    return true;
};
util.argarray = function(args) {
    return Array.prototype.slice.call(args);
};
util.readStream = function(stream, callback) {
    var data = [];
    stream.on('data', function(chunk) {
        data.push(chunk.toString());
    });
    stream.on('end', function() {
        callback(data.join(''));
    });
};

/** Make an object a PeriodicUpdater by adding PeriodicUpdater.call(this) to the constructor.
The object will call this.update() every interval. */
util.PeriodicUpdater = function(updateIntervalMs) {
    var self = this, updateTimeoutId;
    this.__defineGetter__('updateInterval', function() { return updateIntervalMs; });
    this.__defineSetter__('updateInterval', function(milliseconds) {
        clearInterval(updateTimeoutId);
        if (milliseconds > 0 && milliseconds < Infinity) {
            updateTimeoutId = setInterval(self.update.bind(self), milliseconds);
        }
        updateIntervalMs = milliseconds;
    });
    this.updateInterval = updateIntervalMs;
};

/** Same arguments as http.createClient. Returns an wrapped http.Client object that will reconnect when
connection errors are detected. In the current implementation of http.Client (11/29/10), calls to
request() fail silently after the initial 'error' event. */
util.createReconnectingClient = function() {
    var http = require('http'),
        clientArgs = arguments, events = {}, client, wrappedClient = {},
        clientMethod = function(method) { 
            return function() { return client[method].apply(client, arguments); };
        },
        clientGetter = function(member) { return function() { return client[member]; };},
        clientSetter = function(member) { return function(val) { client[member] = val; };},
        reconnect = function() {
            var oldclient = client;
            if (oldclient) { oldclient.destroy(); }
            client = http.createClient.apply(http, clientArgs);
            client._events = util.extend(events, client._events); // EventEmitter._events stores event handlers
            client.emit('reconnect', oldclient);
        };
    
    // Create initial http.Client
    reconnect();
    client.on('error', function(err) { reconnect(); });

    // Wrap client so implementation can be swapped out when there are connection errors
    for (var j in client) {
        if (typeof client[j] === 'function') {
            wrappedClient[j] = clientMethod(j);
        } else {
            wrappedClient.__defineGetter__(j, clientGetter(j));
            wrappedClient.__defineSetter__(j, clientSetter(j));
        }
    }
    wrappedClient.impl = client;
    return wrappedClient;
};

/** Accepts an EventEmitter object that emits text data. LineReader buffers the text and emits a 'data'
event each time a newline is encountered. For example, */
util.LineReader = function(eventEmitter, event) {  
  EventEmitter.call(this);
  event = event || 'data';
  
  var self = this, buffer = '';

  var emitLine = function(buffer) {
    var lineEnd = buffer.indexOf("\n");
    var line = (lineEnd === -1) ? buffer : buffer.substring(0, lineEnd);
    if (line) { self.emit('data', line); }
    return buffer.substring(line.length + 1, buffer.length);
  };
  
  var readloop = function(data) { 
    if (data) { buffer += data.toString(); }
    if (buffer.indexOf("\n") > -1) {     
      buffer = emitLine(buffer);
      process.nextTick(readloop.bind(this));
    }
  };
  
  eventEmitter.on(event, readloop.bind(this));
}
util.inherits(util.LineReader, EventEmitter);

util.extend(exports, util);// ------------------------------------
// Statistics
// ------------------------------------
//
// Defines various statistics classes and function. The classes implement the same consistent interface. 
// See NODELOADLIB.md for a complete description of the classes and functions.
//
/*jslint forin:true */
var BUILD_AS_SINGLE_FILE, stats = {};
if (BUILD_AS_SINGLE_FILE === undefined) {
var fs = require('fs');
}

var Histogram = stats.Histogram = function Histogram(params) {
    // default histogram size of 3000: when tracking latency at ms resolution, this
    // lets us store latencies up to 3 seconds in the main array
    this.type = 'Histogram';
    this.params = params;
    this.size = params && params.buckets || 3000;
    this.percentiles = params && params.percentiles || [0.95, 0.99];
    this.clear();
};
Histogram.prototype =  {
    clear: function() {
        this.start = new Date();
        this.length = 0;
        this.sum = 0;
        this.min = -1;
        this.max = -1;
        this.items = new Array(this.size);      // The main histogram buckets
        this.extra = [];                        // Any items falling outside of the buckets
        this.sorted = true;                     // Is extra[] currently sorted?
    },
    put: function(item) {
        this.length++;
        this.sum += item;
        if (item < this.min || this.min === -1) { this.min = item; }
        if (item > this.max || this.max === -1) { this.max = item; }
        
        if (item < this.items.length) {
            if (this.items[item] !== undefined) {
                this.items[item]++;
            } else {
                this.items[item] = 1;
            }
        } else {
            this.sorted = false;
            this.extra.push(item);
        }
    },
    get: function(item) {
        if (item < this.items.length) {
            return this.items[item];
        } else {
            var count = 0;
            for (var i in this.extra) {
                if (this.extra[i] === item) {
                    count++;
                }
            }
            return count;
        }
    },
    mean: function() {
        return this.sum / this.length;
    },
    percentile: function(percentile) {
        var target = Math.floor(this.length * (1 - percentile));
        
        if (this.extra.length > target) {
            var idx = this.extra.length - target - 1;
            if (!this.sorted) {
                this.extra = this.extra.sort(function(a, b) { return a - b; });
                this.sorted = true;
            }
            return this.extra[idx];
        } else {
            var sum = this.extra.length;
            for (var i = this.items.length - 1; i >= 0; i--) {
                if (this.items[i] > 0) {
                    sum += this.items[i];
                    if (sum >= target) {
                        return i;
                    }
                }
            }
            return 0;
        }
    },
    stddev: function() {
        var mean = this.mean();
        var s = 0;
        
        for (var i = 0; i < this.items.length; i++) {
            if (this.items[i] !== undefined) {
                s += this.items[i] * Math.pow(i - mean, 2);
            }
        }
        this.extra.forEach(function (val) {
            s += Math.pow(val - mean, 2);
        });
        return Math.sqrt(s / this.length);
    },
    summary: function() {
        var self = this,
            s = {
                min: self.min,
                max: self.max,
                avg: Number(self.mean().toFixed(1)),
                median: self.percentile(0.5)
            };
        self.percentiles.forEach(function(percentile) {
            s[percentile * 100 + "%"] = self.percentile(percentile);
        });
        return s;
    },
    merge: function(other) {
        if (this.items.length !== other.items.length) {
            throw "Incompatible histograms";
        }

        this.length += other.length;
        this.sum += other.sum;
        this.min = (other.min !== -1 && (other.min < this.min || this.min === -1)) ? other.min : this.min;
        this.max = (other.max > this.max || this.max === -1) ? other.max : this.max;
        for (var i = 0; i < this.items.length; i++) {
            if (this.items[i] !== undefined) {
                this.items[i] += other.items[i];
            } else {
                this.items[i] = other.items[i];
            }
        }
        this.extra = this.extra.concat(other.extra);
        this.sorted = false;
    }
};

var Accumulator = stats.Accumulator = function Accumulator() {
    this.type = 'Accumulator';
    this.total = 0;
    this.length = 0;
};
Accumulator.prototype = {
    put: function(stat) {
        this.total += stat;
        this.length++;
    },
    get: function() {
        return this.total;
    },
    clear: function() {
        this.total = 0;
        this.length = 0;
    },
    summary: function() {
        return { total: this.total };
    },
    merge: function(other) {
        this.total += other.total;
        this.length += other.length;
    }
};

var ResultsCounter = stats.ResultsCounter = function ResultsCounter() {
    this.type = 'ResultsCounter';
    this.start = new Date();
    this.items = {};
    this.length = 0;
};
ResultsCounter.prototype = {
    put: function(item) {
        if (this.items[item] !== undefined) {
            this.items[item]++;
        } else {
            this.items[item] = 1;
        }
        this.length++;
    },
    get: function(item) {
        if (item.length > 0) {
            var total = 0;
            for (var i in item) {
                total += this.items[i];
            }
            return total;
        } else {
            return this.items[item];
        }
    },
    clear: function() {
        this.start = new Date();
        this.items = {};
        this.length = 0;
    },
    summary: function() {
        var items = {};
        for (var i in this.items) {
            items[i] = this.items[i];
        }
        items.total = this.length;
        return items;
    },
    merge: function(other) {
        for (var i in other.items) {
            if (this.items[i] !== undefined) {
                this.items[i] += other.items[i];
            } else {
                this.items[i] = other.items[i];
            }
        }
        this.length += other.length;
    }
};

var Uniques = stats.Uniques = function Uniques() {
    this.type = 'Uniques';
    this.start = new Date();
    this.items = {};
    this.uniques = 0;
    this.length = 0;
};
Uniques.prototype = {
    put: function(item) {
        if (this.items[item] !== undefined) {
            this.items[item]++;
        } else {
            this.items[item] = 1;
            this.uniques++;
        }
        this.length++;
    },
    get: function() {
        return this.uniques;
    },
    clear: function() {
        this.items = {};
        this.uniques = 0;
        this.length = 0;
    },
    summary: function() {
        return {total: this.length, uniqs: this.uniques};
    },
    merge: function(other) {
        for (var i in other.items) {
            if (this.items[i] !== undefined) {
                this.items[i] += other.items[i];
            } else {
                this.items[i] = other.items[i];
                this.uniques++;
            }
        }
        this.length += other.length;
    }
};

var Peak = stats.Peak = function Peak() {
    this.type = 'Peak';
    this.peak = 0;
    this.length = 0;
};
Peak.prototype = {
    put: function(item) {
        if (this.peak < item) {
            this.peak = item;
        }
        this.length++;
    },
    get: function(item) {
        return this.peak;
    },
    clear: function() {
        this.peak = 0;
    },
    summary: function() {
        return { max: this.peak };
    },
    merge: function(other) {
        if (this.peak < other.peak) {
            this.peak = other.peak;
        }
        this.length += other.length;
    }
};

var Rate = stats.Rate = function Rate() {
    this.type = 'Rate';
    this.start = new Date();
    this.length = 0;
};
Rate.prototype = {
    put: function() {
        this.length++;
    },
    get: function() {
        return Number((this.length / ((new Date() - this.start) / 1000)).toFixed(1));
    },
    clear: function() {
        this.start = new Date();
        this.length = 0;
    },
    summary: function() {
        return { rps: this.get() };
    },
    merge: function(other) {
        this.length += other.length;
    }
};

var LogFile = stats.LogFile = function LogFile(filename) {
    this.type = 'LogFile';
    this.writepos = null;
    this.length = 0;
    this.filename = filename;
    this.open();
};
LogFile.prototype = {
    put: function(item) {
        var buf = new Buffer(item);
        fs.write(this.fd, buf, 0, buf.length, this.writepos);
        this.writepos = null;
        this.length += item.length;
    },
    get: function(item) {
        fs.statSync(this.filename, function(err, stats) {
            if (!err) { item = stats; }
        });
        return item;
    },
    clear: function(text) {
        var self = this;
        self.writepos = 0;
        fs.truncate(self.fd, 0, function(err) {
            if (text !== undefined) { self.put(text); }
        });
    },
    open: function() {
        this.fd = fs.openSync(this.filename, "a");
    },
    close: function() {
        fs.closeSync(this.fd);
        this.fd = null;
    },
    summary: function() {
        return { file: this.filename, written: this.length };
    }
};

var NullLog = stats.NullLog = function NullLog() { 
    this.type = 'NullLog';
    this.length = 0;
};
NullLog.prototype = {
    put: function(item) { /* nop */ },
    get: function(item) { return null; },
    clear: function() { /* nop */ }, 
    open: function() { /* nop */ },
    close: function() { /* nop */ },
    summary: function() { return { file: 'null', written: 0 }; }
};

var Reportable = stats.Reportable = function Reportable(name, Backend, backendparams) {
    this.type = 'Reportable';
    this.name = name || '';
    this.length = 0;
    this.interval = new Backend(backendparams);
    this.cumulative = new Backend(backendparams);
    this.lastSummary = null;
};
Reportable.prototype = {
    put: function(stat) {
        if (!this.disableIntervalReporting) {
            this.interval.put(stat);
        }
        this.cumulative.put(stat);
        this.length++;
        this.lastSummary = null;
    },
    get: function() { 
        return null; 
    },
    clear: function() {
        this.interval.clear();
        this.cumulative.clear();
    }, 
    next: function() {
        if (this.interval.length > 0) {
            this.interval.clear();
        }
        this.lastSummary = null;
    },
    summary: function() {
        if (this.lastSummary) { return this.lastSummary; }
        return { interval: this.interval.summary(), cumulative: this.cumulative.summary() };
    },
    merge: function(other) {
        // other should be an instance of backend, NOT Reportable.
        this.interval.merge(other);
        this.cumulative.merge(other);
    }
};

var StatsGroup = stats.StatsGroup = function StatsGroup() {
    Object.defineProperty(this, 'name', {
        enumerable: false,
        writable: true,
    });
    Object.defineProperty(this, 'put', {
        enumerable: false,
        value: function(statNameOrVal, val) {
            if (arguments.length < 2) {
                for (var i in this) { this[i].put(statNameOrVal); }
            } else {
                if (this[statNameOrVal]) { this[statNameOrVal].put(val); }
            }
        }
    });
    Object.defineProperty(this, 'get', {
        enumerable: false,
        value: function(statName) {
            if (arguments.length === 1) {
                var val = {};
                for (var i in this) { 
                    val[i] = this[i].get.apply(this[i], arguments);
                }
                return val;
            }
            if (!this[statName]) { 
                return undefined; 
            }
            console.log(this[statName]);
            var getArgs = Array.prototype.slice.call(arguments, 1);
            return this[statName].get.apply(this[statName], getArgs);
        }
    });
    Object.defineProperty(this, 'clear', {
        enumerable: false,
        value: function(statName) {
            if (statName) {
                this[statName].clear();
            } else {
                for (var i in this) { this[i].clear(); }
            }
        }
    });
    Object.defineProperty(this, 'summary', {
        enumerable: false,
        value: function(statName) {
            if (statName) {
                return this[statName].summary();
            }

            var summary = {ts: new Date()};
            if (this.name) { summary.name = this.name; }
            for (var i in this) {
                summary[i] = this[i].summary();
            }
            return summary;
        }
    });
};

/** Merge all the stats from one group of stats, {"statistic-name": StatsObject, ...} */
var mergeStatsGroups = stats.mergeStatsGroups = function(sourceGroup, targetGroup) {
    for (var statName in sourceGroup) {
        var sourceStats = sourceGroup[statName];
        if (targetGroup[statName] === undefined) {
            targetGroup[statName] = new stats[sourceStats.type](sourceStats.params);
        }
        targetGroup[statName].merge(sourceStats);
    }
};

var roundRobin = stats.roundRobin = function(list) {
    var r = list.slice();
    r.rridx = -1;
    r.get = function() {
        r.rridx = (r.rridx+1) % r.length;
        return r[r.rridx];
    };
    return r;
};

var randomString = stats.randomString = function(length) {
    var s = "";
    for (var i = 0; i < length; i++) {
        s += '\\' + (Math.floor(Math.random() * 95) + 32).toString(8); // ascii chars between 32 and 126
    }
    return eval("'" + s + "'");
};

var nextGaussian = stats.nextGaussian = function(mean, stddev) {
    mean = mean || 0;
    stddev = stddev || 1;
    var s = 0, z0, z1;
    while (s === 0 || s >= 1) {
        z0 = 2 * Math.random() - 1;
        z1 = 2 * Math.random() - 1;
        s = z0*z0 + z1*z1;
    }
    return z0 * Math.sqrt(-2 * Math.log(s) / s) * stddev + mean;
};

var nextPareto = stats.nextPareto = function(min, max, shape) {
    shape = shape || 0.1;
    var l = 1, h = Math.pow(1+max-min, shape), rnd = Math.random();
    while (rnd === 0) { rnd = Math.random(); }
    return Math.pow((rnd*(h-l)-h) / -(h*l), -1/shape)-1+min;
};

// Export everything in stats namespace
for (var i in stats) { exports[i] = stats[i]; }// -----------------------------------------
// Event-based looping
// -----------------------------------------
// 
// This file defines Loop and MultiLoop.
//
// Nodeload uses the node.js event loop to repeatedly call a function. In order for this to work, the
// function cooperates by accepting a function, finished, as its first argument and calls finished()
// when it completes. This is refered to as "event-based looping" in nodeload.
// 
/*jslint laxbreak: true, undef: true */
/*global setTimeout: false */
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var EventEmitter = require('events').EventEmitter;
}

/** LOOP_OPTIONS defines all of the parameters that used with Loop.create(), MultiLoop() */
var LOOP_OPTIONS = exports.LOOP_OPTIONS = {
    fun: undefined,                 // A function to execute which accepts the parameters (finished, args).
                                    // The value of args is the return value of argGenerator() or the args
                                    // parameter if argGenerator is undefined. The function must call 
                                    // finished(results) when it completes.
    argGenerator: undefined,             // A function which is called once when the loop is started. The return
                                    // value is passed to fun as the "args" parameter. This is useful when
                                    // concurrency > 1, and each "thread" should have its own args.
    args: undefined,                     // If argGenerator is NOT specified, then this is passed to the fun as
                                    // "args".
    rps: Infinity,                  // Target number of time per second to call fun()
    duration: Infinity,             // Maximum duration of this loop in seconds
    numberOfTimes: Infinity,        // Maximum number of times to call fun()
    concurrency: 1,                 // (MultiLoop only) Number of concurrent calls of fun()
                                    //
    concurrencyProfile: undefined,  // (MultiLoop only) array indicating concurrency over time:
                                    //      [[time (seconds), # users], [time 2, users], ...]
                                    // For example, ramp up from 0 to 100 "threads" and back down to 0 over
                                    // 20 seconds:
                                    //      [[0, 0], [10, 100], [20, 0]]
                                    //
    rpsProfile: undefined           // (MultiLoop only) array indicating execution rate over time:
                                    //      [[time (seconds), rps], [time 2, rps], ...]
                                    // For example, ramp up from 100 to 500 rps and then down to 0 over 20
                                    // seconds:
                                    //      [[0, 100], [10, 500], [20, 0]]
};

/** Loop wraps an arbitrary function to be executed in a loop. Each iteration of the loop is scheduled
in the node.js event loop using process.nextTick(), which allows other events in the loop to be handled
as the loop executes. Loop emits the events 'start' (before the first iteration), 'end', 'startiteration'
and 'enditeration'.

@param funOrSpec    Either a loop specification object or a loop function. LOOP_OPTIONS lists all the 
                    supported fields in a loop specification.

                    A loop function is an asynchronous function that calls finished(result) when it
                    finishes:
                    
                        function(finished, args) {
                            ...
                            finished(result);
                        }
                    
                    use the static method Loop.funLoop(f) to wrap simple, non-asynchronous functions.
@param args         passed as-is as the second argument to fun
@param conditions   a list of functions that are called at the beginning of every loop. If any 
                    function returns false, the loop terminates. Loop#timeLimit and Loop#maxExecutions 
                    are conditions that can be used here. 
@param rps          max number of times per second this loop should execute */
var Loop = exports.Loop = function Loop(funOrSpec, args, conditions, rps) {
    EventEmitter.call(this);
    
    if (typeof funOrSpec === 'object') {
        var spec = util.defaults(funOrSpec, LOOP_OPTIONS);

        funOrSpec = spec.fun;
        args = spec.argGenerator ? spec.argGenerator() : spec.args;
        conditions = [];
        rps = spec.rps;

        if (spec.numberOfTimes > 0 && spec.numberOfTimes < Infinity) {
            conditions.push(Loop.maxExecutions(spec.numberOfTimes));
        }
        if (spec.duration > 0 && spec.duration < Infinity) {
            conditions.push(Loop.timeLimit(spec.duration));
        }
    }

    this.__defineGetter__('rps', function() { return rps; });
    this.__defineSetter__('rps', function(val) {
        rps = (val >= 0) ? val : Infinity;
        this.timeout_ = Math.floor(1/rps * 1000);
        if (this.restart_ && this.timeout_ < Infinity) {
            var oldRestart = this.restart_;
            this.restart_ = null;
            oldRestart();
        }
    });
    
    this.id = util.uid();
    this.fun = funOrSpec;
    this.args = args;
    this.conditions = conditions || [];
    this.running = false;
    this.rps = rps;
};

util.inherits(Loop, EventEmitter);

/** Start executing this.fun with the arguments, this.args, until any condition in this.conditions
returns false. When the loop completes the 'end' event is emitted. */
Loop.prototype.start = function() {
    var self = this,
        startLoop = function() {
            self.emit('start');
            self.loop_();
        };

    if (self.running) { return; }
    self.running = true;
    process.nextTick(startLoop);
    return this;
};

Loop.prototype.stop = function() {
    this.running = false;
};

/** Calls each function in Loop.conditions. Returns false if any function returns false */
Loop.prototype.checkConditions_ = function() {
    return this.running && this.conditions.every(function(c) { return c(); });
};

/** Checks conditions and schedules the next loop iteration. 'startiteration' is emitted before each
iteration and 'enditeration' is emitted after. */
Loop.prototype.loop_ = function() {
    
    var self = this, result, active, lagging,
        callfun = function() {
            if (self.timeout_ === Infinity) { 
                self.restart_ = callfun;
                return;
            }

            result = null; active = true; lagging = (self.timeout_ <= 0);
            if (!lagging) {
                setTimeout(function() { 
                    lagging = active;
                    if (!lagging) { self.loop_(); }
                }, self.timeout_);
            }
            self.emit('startiteration', self.args);
            var start = new Date();
            self.fun(function(res) { 
                    active = false;
                    result = res;
                    self.emit('enditeration', result);
                    if (lagging) { self.loop_(); }
                }, self.args);
        };

    if (self.checkConditions_()) {
        process.nextTick(callfun);
    } else {
        self.running = false;
        self.emit('end');
    }
};


// Predefined functions that can be used in Loop.conditions

/** Returns false after a given number of seconds */
Loop.timeLimit = function(seconds) {
    var start = new Date();
    return function() { 
        return (seconds === Infinity) || ((new Date() - start) < (seconds * 1000));
    };
};
/** Returns false after a given number of iterations */
Loop.maxExecutions = function(numberOfTimes) {
    var counter = 0;
    return function() { 
        return (numberOfTimes === Infinity) || (counter++ < numberOfTimes);
    };
};


// Helpers for dealing with loop functions

/** A wrapper for any existing function so it can be used by Loop. e.g.:
        myfun = function(x) { return x+1; }
        new Loop(Loop.funLoop(myfun), args, [Loop.timeLimit(10)], 0) */
Loop.funLoop = function(fun) {
    return function(finished, args) {
        finished(fun(args));
    };
};
/** Wrap a loop function. For each iteration, calls startRes = start(args) before calling fun(), and
calls finish(result-from-fun, startRes) when fun() finishes. */
Loop.loopWrapper = function(fun, start, finish) {
    return function(finished, args) {
        var startRes = start && start(args),
            finishFun = function(result) {
                if (result === undefined) {
                    util.qputs('Function result is null; did you forget to call finished(result)?');
                }

                if (finish) { finish(result, startRes); }
                
                finished(result);
            };
        fun(finishFun, args);
    };
};// -----------------------------------------
// MultiLoop 
// -----------------------------------------
//
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var loop = require('./loop');
var EventEmitter = require('events').EventEmitter;
var Loop = loop.Loop;
var LOOP_OPTIONS = loop.LOOP_OPTIONS;
}

/** MultiLoop accepts a single loop specification, but allows it to be executed concurrently by creating
multiple Loop instances. The execution rate and concurrency are changed over time using profiles. 
LOOP_OPTIONS lists the supported specification parameters. */ 
var MultiLoop = exports.MultiLoop = function MultiLoop(spec) {
    EventEmitter.call(this);

    this.spec = util.extend({}, util.defaults(spec, LOOP_OPTIONS));
    this.loops = [];
    this.concurrencyProfile = spec.concurrencyProfile || [[0, spec.concurrency]];
    this.rpsProfile = spec.rpsProfile || [[0, spec.rps]];
    this.updater_ = this.update_.bind(this);
    this.finishedChecker_ = this.checkFinished_.bind(this);
};

util.inherits(MultiLoop, EventEmitter);

/** Start all scheduled Loops. When the loops complete, 'end' event is emitted. */
MultiLoop.prototype.start = function() {
    if (this.running) { return; }
    this.running = true;
    this.startTime = new Date();
    this.rps = 0;
    this.concurrency = 0;
    this.loops = [];
    this.loopConditions_ = [];

    if (this.spec.numberOfTimes > 0 && this.spec.numberOfTimes < Infinity) {
        this.loopConditions_.push(Loop.maxExecutions(this.spec.numberOfTimes));
    }
    
    if (this.spec.duration > 0 && this.spec.duration < Infinity) {
        this.endTimeoutId = setTimeout(this.stop.bind(this), this.spec.duration * 1000);
    }

    process.nextTick(this.emit.bind(this, 'start'));
    this.update_();
    return this;
};

/** Force all loops to finish */
MultiLoop.prototype.stop = function() {
    if (!this.running) { return; }
    clearTimeout(this.endTimeoutId);
    clearTimeout(this.updateTimeoutId);
    this.running = false;
    this.loops.forEach(function(l) { l.stop(); });
    this.emit('remove', this.loops);
    this.emit('end');
    this.loops = [];
};

/** Given a profile in the format [[time, value], [time, value], ...], return the value corresponding
to the given time. Transitions between points are currently assumed to be linear, and value=0 at time=0
unless otherwise specified in the profile. */
MultiLoop.prototype.getProfileValue_ = function(profile, time) {
    if (!profile || profile.length === 0) { return 0; }
    if (time < 0) { return profile[0][0]; }

    var lastval = [0,0];
    for (var i = 0; i < profile.length; i++) {
        if (profile[i][0] === time) { 
            return profile[i][1]; 
        } else if (profile[i][0] > time) {
            var dx = profile[i][0]-lastval[0], dy = profile[i][1]-lastval[1];
            return Math.floor((time-lastval[0]) / dx * dy + lastval[1]);
        }
        lastval = profile[i];
    }
    return profile[profile.length-1][1];
};

/** Given a profile in the format [[time, value], [time, value], ...], and the current time, return the
time (rounded up to the nearest whole unit) before the profile value will change by 1. */
MultiLoop.prototype.getProfileTimeToNextValue_ = function(profile, time) {
    if (!profile || profile.length === 0) { return Infinity; }
    if (time < 0) { return -time; }

    var MIN_TIMEOUT = 1, lastval = [0,0];
    for (var i = 0; i < profile.length; i++) {
        if (profile[i][0] > time) {
            var dt = (profile[i][0]-time),
                timePerUnitChange = dt / Math.abs(profile[i][1]-lastval[1]);
            return Math.ceil(Math.max(MIN_TIMEOUT, Math.min(dt, timePerUnitChange)));
        }
        lastval = profile[i];
    }
    return Infinity;
};

MultiLoop.prototype.update_ = function() {
    var i, now = Math.floor((new Date() - this.startTime) / 1000),
        concurrency = this.getProfileValue_(this.concurrencyProfile, now),
        rps = this.getProfileValue_(this.rpsProfile, now),
        timeout = Math.min(
          this.getProfileTimeToNextValue_(this.concurrencyProfile, now), 
          this.getProfileTimeToNextValue_(this.rpsProfile, now)) * 1000;
    
    if (concurrency < this.concurrency) {
        var removed = this.loops.splice(concurrency);
        removed.forEach(function(l) { l.stop(); });
        this.emit('remove', removed);
    } else if (concurrency > this.concurrency) {
        var loops = [];
        for (i = 0; i < concurrency-this.concurrency; i++) {
            var args = this.spec.argGenerator ? this.spec.argGenerator() : this.spec.args,
                loop = new Loop(this.spec.fun, args, this.loopConditions_, 0).start();
            loop.on('end', this.finishedChecker_);
            loops.push(loop);
        }
        this.loops = this.loops.concat(loops);
        this.emit('add', loops);
    }
    
    if (concurrency !== this.concurrency || rps !== this.rps) {
        var rpsPerLoop = (rps / concurrency);
        this.loops.forEach(function(l) { l.rps = rpsPerLoop; });
        this.emit('rps', rps);
    }
    
    this.concurrency = concurrency;
    this.rps = rps;

    if (timeout < Infinity) {
        this.updateTimeoutId = setTimeout(this.updater_, timeout);
    }
};

MultiLoop.prototype.checkFinished_ = function() {
    if (!this.running) { return true; }
    if (this.loops.some(function (l) { return l.running; })) { return false; }
    this.running = false;
    this.emit('end');
    return true;
};
//
// Define new statistics that Monitor can track by adding to this file. Each class should have:
//
// - stats, a member which implements the standard interface found in stats.js
// - start(context, args), optional, called when execution of the instrumented code is about to start
// - end(context, result), optional, called when the instrumented code finishes executing 
//
// Defining .disableIntervalCollection and .disableCumulativeCollection to the collection of per-interval
// and overall statistics respectively.
// 

/*jslint sub:true */
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var stats = require('../stats');
var Histogram = stats.Histogram;
var Peak = stats.Peak;
var ResultsCounter = stats.ResultsCounter;
var Rate = stats.Rate;
var Uniques = stats.Uniques;
var Accumulator = stats.Accumulator;
var LogFile = stats.LogFile;
var StatsCollectors = exports;
} else {
var StatsCollectors = {};
}

/** Track the runtime of an operation, storing stats in a stats.js#Histogram  */
StatsCollectors['runtime'] = StatsCollectors['latency'] = function RuntimeCollector(params) {
    var self = this;
    self.stats = new Histogram(params);
    self.start = function(context) { context.start = new Date(); };
    self.end = function(context) { self.stats.put(new Date() - context.start); };
};

/** Track HTTP response codes, storing stats in a stats.js#ResultsCounter object. The client must call 
.end({res: http.ClientResponse}). */
StatsCollectors['result-codes'] = function ResultCodesCollector() {
    var self = this;
    self.stats = new ResultsCounter();
    self.end = function(context, http) { self.stats.put(http.res.statusCode); };
};

/** Track requests per second, storing stats in a stats.js#Rate object. The client must call 
.end({res: http.ClientResponse}). */
StatsCollectors['rps'] = function RpsCollector() {
    var self = this;
    self.stats = new Rate();
    self.end = function(context, http) { self.stats.put(); };
};

/** Track a status code that is returned in an HTTP header, storing stats in a stats.js#ResultsCounter
object. The client must call .end({res: http.ClientResponse}). */
StatsCollectors['header-code'] = function HeaderCodeCollector(params) {
    if (!params.header) { throw new Error('"header" is a required parameter for header-code'); }
    var self = this, header = params.header.toLowerCase(), regex = params.regex;
    self.stats = new ResultsCounter();
    self.end = function(context, http) {
        var val = http.res.headers[header];
        if (regex && val !== undefined) {
            val = val.match(regex);
            val = val && val[1] || undefined;
        }
        if (val !== undefined) { self.stats.put(val); }
    };
};

/** Track the concurrent executions (ie. stuff between calls to .start() and .end()), storing in a 
stats.js#Peak. */
StatsCollectors['concurrency'] = function ConcurrencyCollector() {
    var self = this, c = 0;
    self.stats = new Peak();
    self.start = function() { c++; };
    self.end = function() { self.stats.put(c--); };
};

/** Track the size of HTTP request bodies sent by adding up the content-length headers. This function
doesn't really work as you'd hope right now, since it doesn't work for chunked encoding messages and 
doesn't return actual bytes over the wire (headers, etc). */
StatsCollectors['request-bytes'] = function RequestBytesCollector() {
    var self = this;
    self.stats = new Accumulator();
    self.end = function(context, http) {
        if (http && http.req) {
            if (http.req._header) { self.stats.put(http.req._header.length); }
            if (http.req.body) { self.stats.put(http.req.body.length); }
        }
    };
};

/** Track the size of HTTP response bodies. It doesn't account for headers! */
StatsCollectors['response-bytes'] = function ResponseBytesCollector() {
    var self = this;
    self.stats = new Accumulator();
    self.end = function(context, http) { 
        if (http && http.res) { 
            http.res.on('data', function(chunk) {
                self.stats.put(chunk.length);
            });
        }
    };
};

/** Track unique URLs requested, storing stats in a stats.js#Uniques object. The client must call 
Monitor.start({req: http.ClientRequest}). */
StatsCollectors['uniques'] = function UniquesCollector() {
    var self = this;
    self.stats = new Uniques();
    self.end = function(context, http) { 
        if (http && http.req) { self.stats.put(http.req.path); }
    };
};
StatsCollectors['uniques'].disableIntervalCollection = true; // Per-interval stats should be not be collected

/** Track number HTTP response codes that are considered errors. Can also log request / response 
information to disk when an error response is received. Specify the acceptable HTTP status codes in
params.successCodes. Specify the log file name in params.log, or leave undefined to disable logging. */
StatsCollectors['http-errors'] = function HttpErrorsCollector(params) {
    var self = this;
    self.stats = new Accumulator();
    self.successCodes = params.successCodes || [200];
    self.logfile = (typeof params.log === 'string') ? new LogFile(params.log) : params.log;
    self.logResBody = ( params.hasOwnProperty('logResBody') ) ? params.logResBody : true;
    self.end = function(context, http) {
        if (self.successCodes.indexOf(http.res.statusCode) < 0) {
            self.stats.put(1);

            if (self.logfile) {
                util.readStream(http.res, function(body) {
                    var logObj = { ts: new Date(), 
                        req: {
                            headers: http.req._header,
                            body: http.req.body,
                        },
                        res: {
                            statusCode: http.res.statusCode, 
                            headers: http.res.headers
                        }
                    };
                    if (self.logResBody) {
                        logObj.res.body = body;
                    }
                    self.logfile.put(JSON.stringify(logObj) + '\n');
                });
            }
        }
    };
};
StatsCollectors['http-errors'].disableIntervalCollection = true; // Per-interval stats should be not be collected

/** Track number HTTP response codes that are considered errors. Can also log request / response 
information to disk when an error response is received. Specify the acceptable HTTP status codes in
params.successCodes. Specify the log file name in params.log, or leave undefined to disable logging. */
StatsCollectors['slow-responses'] = function HttpErrorsCollector(params) {
    var self = this;
    self.stats = new Accumulator();
    self.threshold = params.threshold || 1000;
    self.logfile = (typeof params.log === 'string') ? new LogFile(params.log) : params.log;
    self.logResBody = ( params.hasOwnProperty('logResBody') ) ? params.logResBody : true;
    self.start = function(context) { context.start = new Date(); };
    self.end = function(context, http) {
        var runTime = new Date() - context.start;
        if (runTime > self.threshold) {
            self.stats.put(1);

            if (self.logfile) {
                util.readStream(http.res, function(body) {
                    var logObj = { ts: new Date(), 
                        req: {
                            // Use the _header "private" member of http.ClientRequest, available as of 
                            // node v0.2.2 (9/30/10). This is the only way to reliably get all request
                            // headers, since ClientRequest adds headers beyond what the user specifies
                            // in certain conditions, like Connection and Transfer-Encoding. 
                            headers: http.req._header,
                            body: http.req.body,
                        },
                        res: {
                            statusCode: http.res.statusCode, 
                            headers: http.res.headers
                        },
                        latency: runTime
                    };
                    if (self.logResBody) {
                        logObj.res.body = body;
                    }
                    self.logfile.put(JSON.stringify(logObj) + '\n');
                });
            }
        }
    };
};
StatsCollectors['slow-responses'].disableIntervalCollection = true; // Per-interval stats should be not be collected// -----------------
// StatsLogger
// -----------------
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var START = require('../config').NODELOAD_CONFIG.START;
var LogFile = require('../stats').LogFile;
}

/** StatsLogger writes interval stats from a Monitor or MonitorGroup to disk each time it emits 'update' */
var StatsLogger = exports.StatsLogger = function StatsLogger(monitor, logNameOrObject) {
    this.logNameOrObject = logNameOrObject || ('results-' + START.toISOString() + '-stats.log');
    this.monitor = monitor;
    this.logger_ = this.log_.bind(this);
};
StatsLogger.prototype.start = function() {
    this.createdLog = (typeof this.logNameOrObject === 'string');
    this.log = this.createdLog ? new LogFile(this.logNameOrObject) : this.logNameOrObject;
    this.monitor.on('update', this.logger_);
    return this;
};
StatsLogger.prototype.stop = function() {
    if (this.createdLog) {
        this.log.close();
        this.log = null;
    }
    this.monitor.removeListener('update', this.logger_);
    return this;
};
StatsLogger.prototype.log_ = function() {
    var summary = this.monitor.interval.summary();
    this.log.put(JSON.stringify(summary) + ',\n');
};// -----------------
// Monitor
// -----------------
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var StatsCollectors = require('./collectors');
var StatsLogger = require('./statslogger').StatsLogger;
var EventEmitter = require('events').EventEmitter;
}

/** Monitor is used to track code statistics of code that is run multiple times or concurrently:

     var monitor = new Monitor('runtime');
     function f() {
         var m = monitor.start();
         doSomethingAsynchronous(..., function() {
             m.end();
         });
     }
     ...
     console.log('f() median runtime (ms): ' + monitor.stats['runtime'].percentile(.5));

Look at monitoring.test.js for more examples.

Monitor can also emits periodic 'update' events with overall and statistics since the last 'update'. This
allows the statistics to be introspected at regular intervals for things like logging and reporting. Set
Monitor.updateInterval to enable 'update' events.

@param arguments contain names of the statistics to track. Add additional statistics to collectors.js.
*/
var Monitor = exports.Monitor = function Monitor() { // arguments 
    EventEmitter.call(this);
    util.PeriodicUpdater.call(this); // adds updateInterval property and calls update()
    this.targets = [];
    this.setStats.apply(this, arguments);
};

util.inherits(Monitor, EventEmitter);

/** Set the statistics this monitor should gather. */
Monitor.prototype.setStats = function(stats) { // arguments contains stats names
    var self = this,
        summarizeStats = function() {
            var summary = {ts: new Date()};
            if (self.name) { summary.name = self.name; }
            util.forEach(this, function(statName, stats) {
                summary[statName] = stats.summary();
            });
            return summary;
        };

    self.collectors = [];
    self.stats = {};
    self.interval = {};
    stats = (stats instanceof Array) ? stats : Array.prototype.slice.call(arguments);
    stats.forEach(function(stat) {
        var name = stat, params;
        if (typeof stat === 'object') {
            name = stat.name;
            params = stat;
        }
        var Collector = StatsCollectors[name];
        if (!Collector) { 
            throw new Error('No collector for statistic: ' + name); 
        }
        if (!Collector.disableIntervalCollection) {
            var intervalCollector = new Collector(params);
            self.collectors.push(intervalCollector);
            self.interval[name] = intervalCollector.stats;
        }
        if (!Collector.disableCumulativeCollection) {
            var cumulativeCollector = new Collector(params);
            self.collectors.push(cumulativeCollector);
            self.stats[name] = cumulativeCollector.stats;
        }
    });
    
    Object.defineProperty(this.stats, 'summary', {
        enumerable: false,
        value: summarizeStats
    });
    Object.defineProperty(this.interval, 'summary', {
        enumerable: false,
        value: summarizeStats
    });
};

/** Called by the instrumented code when it begins executing. Returns a monitoring context. Call 
context.end() when the instrumented code completes. */
Monitor.prototype.start = function(args) {
    var self = this, 
        endFuns = [],
        doStart = function(m, context) {
            if (m.start) { m.start(context, args); }
            if (m.end) { 
                endFuns.push(function(result) { return m.end(context, result); }); 
            }
        },
        monitoringContext = {
            end: function(result) {
                endFuns.forEach(function(f) { f(result); });
            }
        };
    
    self.collectors.forEach(function(m) { doStart(m, {}); });
    return monitoringContext;
};

/** Monitor a set of EventEmitter objects, where each object is analogous to a thread. The objects
should emit 'start' and 'end' when they begin doing the operation being instrumented. This is useful
for monitoring concurrently executing instances of loop.js#Loop. 

Call either as monitorObjects(obj1, obj2, ...) or monitorObjects([obj1, obj2, ...], 'start', 'end') */
Monitor.prototype.monitorObjects = function(objs, startEvent, endEvent) {
    var self = this;
    
    if (!(objs instanceof Array)) {
        objs = util.argarray(arguments);
        startEvent = endEvent = null;
    }

    startEvent = startEvent || 'start';
    endEvent = endEvent || 'end';

    objs.forEach(function(o) {
        var mon;
        o.on(startEvent, function(args) {
            mon = self.start(args);
        });
        o.on(endEvent, function(result) {
            mon.end(result);
        });
    });

    return self;
};

/** Set the file name or stats.js#LogFile object that statistics are logged to; null for default */
Monitor.prototype.setLogFile = function(logNameOrObject) {
    this.logNameOrObject = logNameOrObject;
};

/** Log statistics each time an 'update' event is emitted? */
Monitor.prototype.setLoggingEnabled = function(enabled) {
    if (enabled) {
        this.logger = this.logger || new StatsLogger(this, this.logNameOrObject).start();
    } else if (this.logger) {
        this.logger.stop();
        this.logger = null;
    }
    return this;
};

/** Emit the 'update' event and reset the statistics for the next window */
Monitor.prototype.update = function() {
    this.emit('update', this.interval, this.stats);
    util.forEach(this.interval, function(name, stats) {
        if (stats.length > 0) {
            stats.clear();
        }
    });
};// -----------------
// MonitorGroup
// -----------------
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var Monitor = require('./monitor').Monitor;
var StatsLogger = require('./statslogger').StatsLogger;
var EventEmitter = require('events').EventEmitter;
}

/** MonitorGroup represents a group of Monitor instances. Calling MonitorGroup('runtime').start('myfunction')
is equivalent to creating a Monitor('runtime') for myfunction and and calling start(). MonitorGroup can 
also emit regular 'update' events as well as log the statistics from the interval to disk.

@param arguments contain names of the statistics to track. Register more statistics by extending
                 Monitor.StatsCollectors. */
var MonitorGroup = exports.MonitorGroup = function MonitorGroup(statsNames) {
    EventEmitter.call(this);
    util.PeriodicUpdater.call(this);

    var summarizeStats = function() {
        var summary = {ts: new Date()};
        util.forEach(this, function(monitorName, stats) {
            summary[monitorName] = {};
            util.forEach(stats, function(statName, stat) {
                summary[monitorName][statName] = stat.summary();
            });
        });
        return summary;
    };

    this.statsNames = (statsNames instanceof Array) ? statsNames : Array.prototype.slice.call(arguments);
    this.monitors = {};
    this.stats = {};
    this.interval = {};
    
    Object.defineProperty(this.stats, 'summary', {
        enumerable: false,
        value: summarizeStats
    });
    Object.defineProperty(this.interval, 'summary', {
        enumerable: false,
        value: summarizeStats
    });
};

util.inherits(MonitorGroup, EventEmitter);

/** Pre-initialize monitors with the given names. This allows construction overhead to take place all at 
once if desired. */
MonitorGroup.prototype.initMonitors = function(monitorNames) {
    var self = this;
    monitorNames = (monitorNames instanceof Array) ? monitorNames : Array.prototype.slice.call(arguments);
    monitorNames.forEach(function(name) { 
        self.monitors[name] = new Monitor(self.statsNames);
        self.stats[name] = self.monitors[name].stats;
        self.interval[name] = self.monitors[name].interval;
    });
    return self;
};

/** Call .start() for the named monitor */
MonitorGroup.prototype.start = function(monitorName, args) {
    monitorName = monitorName || '';
    if (!this.monitors[monitorName]) {
        this.initMonitors([monitorName]);
    }
    return this.monitors[monitorName].start(args);
};

/** Like Monitor.monitorObjects() except each object's 'start' event should include the monitor name as
its first argument. See monitoring.test.js for an example. */
MonitorGroup.prototype.monitorObjects = function(objs, startEvent, endEvent) {
    var self = this, ctxs = {};

    if (!(objs instanceof Array)) {
        objs = util.argarray(arguments);
        startEvent = endEvent = null;
    }

    startEvent = startEvent || 'start';
    endEvent = endEvent || 'end';

    objs.forEach(function(o) {
        o.on(startEvent, function(monitorName, args) {
            ctxs[monitorName] = self.start(monitorName, args);
        });
        o.on(endEvent, function(monitorName, result) {
            if (ctxs[monitorName]) { ctxs[monitorName].end(result); }
        });
    });
    return self;
};

/** Set the file name or stats.js#LogFile object that statistics are logged to; null for default */
MonitorGroup.prototype.setLogFile = function(logNameOrObject) {
    this.logNameOrObject = logNameOrObject;
};

/** Log statistics each time an 'update' event is emitted */
MonitorGroup.prototype.setLoggingEnabled = function(enabled) {
    if (enabled) {
        this.logger = this.logger || new StatsLogger(this, this.logNameOrObject).start();
    } else if (this.logger) {
        this.logger.stop();
        this.logger = null;
    }
    return this;
};

/** Emit the update event and reset the statistics for the next window */
MonitorGroup.prototype.update = function() {
    this.emit('update', this.interval, this.stats);
    util.forEach(this.monitors, function (name, m) { m.update(); });
};// ------------------------------------
// HTTP Server
// ------------------------------------
//
// This file defines HttpServer and the singleton HTTP_SERVER.
//
// This file defines a generic HTTP server that serves static files and that can be configured
// with new routes. It also starts the nodeload HTTP server unless require('nodeload/config')
// .disableServer() was called.
// 
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var config = require('./config');
var http = require('http');
var fs = require('fs');
var util = require('./util');
var qputs = util.qputs;
var EventEmitter = require('events').EventEmitter;
var NODELOAD_CONFIG = config.NODELOAD_CONFIG;
}

/** By default, HttpServer knows how to return static files from the current directory. Add new route 
regexs using HttpServer.on(). */
var HttpServer = exports.HttpServer = function HttpServer() {
    this.routes = [];
    this.running = false;
};
util.inherits(HttpServer, EventEmitter);
/** Start the server listening on the given port */
HttpServer.prototype.start = function(port, hostname) {
    if (this.running) { return; }
    this.running = true;

    var self = this;
    port = port || 8000;
    self.hostname = hostname || 'localhost';
    self.port = port;
    self.connections = [];

    self.server = http.createServer(function(req, res) { self.route_(req, res); });
    self.server.on('connection', function(c) { 
        // We need to track incoming connections, beause Server.close() won't terminate active
        // connections by default.
        c.on('close', function() {
            var idx = self.connections.indexOf(c);
            if (idx !== -1) {
                self.connections.splice(idx, 1);
            }
        });
        self.connections.push(c);
    });
    self.server.listen(port, hostname);

    self.emit('start', self.hostname, self.port);
    return self;
};
/** Terminate the server */
HttpServer.prototype.stop = function() {
    if (!this.running) { return; }
    this.running = false;
    this.connections.forEach(function(c) { c.destroy(); });
    this.server.close();
    this.server = null;
    this.emit('end');
};
/** When an incoming request matches a given regex, route it to the provided handler:
function(url, ServerRequest, ServerResponse) */
HttpServer.prototype.addRoute = function(regex, handler) {
    this.routes.unshift({regex: regex, handler: handler});
    return this;
};
HttpServer.prototype.removeRoute = function(regex, handler) {
    this.routes = this.routes.filter(function(r) {
        return !((regex === r.regex) && (!handler || handler === r.handler));
    });
    return this;
};
HttpServer.prototype.route_ = function(req, res) {
    for (var i = 0; i < this.routes.length; i++) {
        if (req.url.match(this.routes[i].regex)) {
            this.routes[i].handler(req.url, req, res);
            return;
        }
    }
    if (req.method === 'GET') {
        this.serveFile_('.' + req.url, res);
    } else {
        res.writeHead(405, {"Content-Length": "0"});
        res.end();
    }
};
HttpServer.prototype.serveFile_ = function(file, response) {
    fs.stat(file, function(err, stat) {
        if (err) {
            response.writeHead(404, {"Content-Type": "text/plain"});
            response.write("Cannot find file: " + file);
            response.end();
            return;
        }

        fs.readFile(file, "binary", function (err, data) {
            if (err) {
                response.writeHead(500, {"Content-Type": "text/plain"});
                response.write("Error opening file " + file + ": " + err);
            } else {
                response.writeHead(200, { 'Content-Length': data.length });
                response.write(data, "binary");
            }
            response.end();
        });
    });
};

// =================
// Singletons
// =================

/** The global HTTP server used by nodeload */
var HTTP_SERVER = exports.HTTP_SERVER = new HttpServer();
HTTP_SERVER.on('start', function(hostname, port) {
    qputs('Started HTTP server on ' + hostname + ':' + port + '.');
});
HTTP_SERVER.on('end', function() {
    qputs('Shutdown HTTP server.');
});
NODELOAD_CONFIG.on('apply', function() { 
    if (NODELOAD_CONFIG.HTTP_ENABLED) {
        HTTP_SERVER.start(NODELOAD_CONFIG.HTTP_PORT);
    }
});var DYGRAPH_SOURCE= exports.DYGRAPH_SOURCE="DygraphLayout=function(a){this.dygraph_=a;this.datasets=new Array();this.annotations=new Array();this.yAxes_=null;this.xTicks_=null;this.yTicks_=null};DygraphLayout.prototype.attr_=function(a){return this.dygraph_.attr_(a)};DygraphLayout.prototype.addDataset=function(a,b){this.datasets[a]=b};DygraphLayout.prototype.setAnnotations=function(d){this.annotations=[];var e=this.attr_(\"xValueParser\")||function(a){return a};for(var c=0;c<d.length;c++){var b={};if(!d[c].xval&&!d[c].x){this.dygraph_.error(\"Annotations must have an 'x' property\");return}if(d[c].icon&&!(d[c].hasOwnProperty(\"width\")&&d[c].hasOwnProperty(\"height\"))){this.dygraph_.error(\"Must set width and height when setting annotation.icon property\");return}Dygraph.update(b,d[c]);if(!b.xval){b.xval=e(b.x)}this.annotations.push(b)}};DygraphLayout.prototype.setXTicks=function(a){this.xTicks_=a};DygraphLayout.prototype.setYAxes=function(a){this.yAxes_=a};DygraphLayout.prototype.setDateWindow=function(a){this.dateWindow_=a};DygraphLayout.prototype.evaluate=function(){this._evaluateLimits();this._evaluateLineCharts();this._evaluateLineTicks();this._evaluateAnnotations()};DygraphLayout.prototype._evaluateLimits=function(){this.minxval=this.maxxval=null;if(this.dateWindow_){this.minxval=this.dateWindow_[0];this.maxxval=this.dateWindow_[1]}else{for(var c in this.datasets){if(!this.datasets.hasOwnProperty(c)){continue}var e=this.datasets[c];if(e.length>1){var b=e[0][0];if(!this.minxval||b<this.minxval){this.minxval=b}var a=e[e.length-1][0];if(!this.maxxval||a>this.maxxval){this.maxxval=a}}}}this.xrange=this.maxxval-this.minxval;this.xscale=(this.xrange!=0?1/this.xrange:1);for(var d=0;d<this.yAxes_.length;d++){var f=this.yAxes_[d];f.minyval=f.computedValueRange[0];f.maxyval=f.computedValueRange[1];f.yrange=f.maxyval-f.minyval;f.yscale=(f.yrange!=0?1/f.yrange:1);if(f.g.attr_(\"logscale\")){f.ylogrange=Dygraph.log10(f.maxyval)-Dygraph.log10(f.minyval);f.ylogscale=(f.ylogrange!=0?1/f.ylogrange:1);if(!isFinite(f.ylogrange)||isNaN(f.ylogrange)){f.g.error(\"axis \"+d+\" of graph at \"+f.g+\" can't be displayed in log scale for range [\"+f.minyval+\" - \"+f.maxyval+\"]\")}}}};DygraphLayout.prototype._evaluateLineCharts=function(){this.points=new Array();for(var f in this.datasets){if(!this.datasets.hasOwnProperty(f)){continue}var e=this.datasets[f];var c=this.dygraph_.axisPropertiesForSeries(f);for(var b=0;b<e.length;b++){var d=e[b];var g;if(c.logscale){g=1-((Dygraph.log10(parseFloat(d[1]))-Dygraph.log10(c.minyval))*c.ylogscale)}else{g=1-((parseFloat(d[1])-c.minyval)*c.yscale)}var a={x:((parseFloat(d[0])-this.minxval)*this.xscale),y:g,xval:parseFloat(d[0]),yval:parseFloat(d[1]),name:f};this.points.push(a)}}};DygraphLayout.prototype._evaluateLineTicks=function(){this.xticks=new Array();for(var d=0;d<this.xTicks_.length;d++){var c=this.xTicks_[d];var b=c.label;var f=this.xscale*(c.v-this.minxval);if((f>=0)&&(f<=1)){this.xticks.push([f,b])}}this.yticks=new Array();for(var d=0;d<this.yAxes_.length;d++){var e=this.yAxes_[d];for(var a=0;a<e.ticks.length;a++){var c=e.ticks[a];var b=c.label;var f=this.dygraph_.toPercentYCoord(c.v,d);if((f>=0)&&(f<=1)){this.yticks.push([d,f,b])}}}};DygraphLayout.prototype.evaluateWithError=function(){this.evaluate();if(!(this.attr_(\"errorBars\")||this.attr_(\"customBars\"))){return}var d=0;for(var g in this.datasets){if(!this.datasets.hasOwnProperty(g)){continue}var c=0;var f=this.datasets[g];for(var c=0;c<f.length;c++,d++){var e=f[c];var a=parseFloat(e[0]);var b=parseFloat(e[1]);if(a==this.points[d].xval&&b==this.points[d].yval){this.points[d].errorMinus=parseFloat(e[2]);this.points[d].errorPlus=parseFloat(e[3])}}}};DygraphLayout.prototype._evaluateAnnotations=function(){var f={};for(var d=0;d<this.annotations.length;d++){var b=this.annotations[d];f[b.xval+\",\"+b.series]=b}this.annotated_points=[];if(!this.annotations||!this.annotations.length){return}for(var d=0;d<this.points.length;d++){var e=this.points[d];var c=e.xval+\",\"+e.name;if(c in f){e.annotation=f[c];this.annotated_points.push(e)}}};DygraphLayout.prototype.removeAllDatasets=function(){delete this.datasets;this.datasets=new Array()};DygraphLayout.prototype.unstackPointAtIndex=function(b){var a=this.points[b];var d={};for(var c in a){d[c]=a[c]}if(!this.attr_(\"stackedGraph\")){return d}for(var c=b+1;c<this.points.length;c++){if(this.points[c].xval==a.xval){d.yval-=this.points[c].yval;break}}return d};DygraphCanvasRenderer=function(d,c,b,e){this.dygraph_=d;this.layout=e;this.element=c;this.elementContext=b;this.container=this.element.parentNode;this.height=this.element.height;this.width=this.element.width;if(!this.isIE&&!(DygraphCanvasRenderer.isSupported(this.element))){throw\"Canvas is not supported.\"}this.xlabels=new Array();this.ylabels=new Array();this.annotations=new Array();this.chartLabels={};this.area=this.computeArea_();this.container.style.position=\"relative\";this.container.style.width=this.width+\"px\";var a=this.dygraph_.canvas_ctx_;a.beginPath();a.rect(this.area.x,this.area.y,this.area.w,this.area.h);a.clip();a=this.dygraph_.hidden_ctx_;a.beginPath();a.rect(this.area.x,this.area.y,this.area.w,this.area.h);a.clip()};DygraphCanvasRenderer.prototype.attr_=function(a){return this.dygraph_.attr_(a)};DygraphCanvasRenderer.prototype.computeArea_=function(){var a={x:0,y:0};if(this.attr_(\"drawYAxis\")){a.x=this.attr_(\"yAxisLabelWidth\")+2*this.attr_(\"axisTickSize\")}a.w=this.width-a.x-this.attr_(\"rightGap\");a.h=this.height;if(this.attr_(\"drawXAxis\")){if(this.attr_(\"xAxisHeight\")){a.h-=this.attr_(\"xAxisHeight\")}else{a.h-=this.attr_(\"axisLabelFontSize\")+2*this.attr_(\"axisTickSize\")}}if(this.dygraph_.numAxes()==2){a.w-=(this.attr_(\"yAxisLabelWidth\")+2*this.attr_(\"axisTickSize\"))}else{if(this.dygraph_.numAxes()>2){this.dygraph_.error(\"Only two y-axes are supported at this time. (Trying to use \"+this.dygraph_.numAxes()+\")\")}}if(this.attr_(\"title\")){a.h-=this.attr_(\"titleHeight\");a.y+=this.attr_(\"titleHeight\")}if(this.attr_(\"xlabel\")){a.h-=this.attr_(\"xLabelHeight\")}if(this.attr_(\"ylabel\")){}return a};DygraphCanvasRenderer.prototype.clear=function(){if(this.isIE){try{if(this.clearDelay){this.clearDelay.cancel();this.clearDelay=null}var c=this.elementContext}catch(f){this.clearDelay=MochiKit.Async.wait(this.IEDelay);this.clearDelay.addCallback(bind(this.clear,this));return}}var c=this.elementContext;c.clearRect(0,0,this.width,this.height);for(var b=0;b<this.xlabels.length;b++){var d=this.xlabels[b];if(d.parentNode){d.parentNode.removeChild(d)}}for(var b=0;b<this.ylabels.length;b++){var d=this.ylabels[b];if(d.parentNode){d.parentNode.removeChild(d)}}for(var b=0;b<this.annotations.length;b++){var d=this.annotations[b];if(d.parentNode){d.parentNode.removeChild(d)}}for(var a in this.chartLabels){if(!this.chartLabels.hasOwnProperty(a)){continue}var d=this.chartLabels[a];if(d.parentNode){d.parentNode.removeChild(d)}}this.xlabels=new Array();this.ylabels=new Array();this.annotations=new Array();this.chartLabels={}};DygraphCanvasRenderer.isSupported=function(g){var b=null;try{if(typeof(g)==\"undefined\"||g==null){b=document.createElement(\"canvas\")}else{b=g}var c=b.getContext(\"2d\")}catch(d){var f=navigator.appVersion.match(/MSIE (\\d\\.\\d)/);var a=(navigator.userAgent.toLowerCase().indexOf(\"opera\")!=-1);if((!f)||(f[1]<6)||(a)){return false}return true}return true};DygraphCanvasRenderer.prototype.setColors=function(a){this.colorScheme_=a};DygraphCanvasRenderer.prototype.render=function(){var b=this.elementContext;function c(h){return Math.round(h)+0.5}function g(h){return Math.round(h)-0.5}if(this.attr_(\"underlayCallback\")){this.attr_(\"underlayCallback\")(b,this.area,this.dygraph_,this.dygraph_)}if(this.attr_(\"drawYGrid\")){var e=this.layout.yticks;b.save();b.strokeStyle=this.attr_(\"gridLineColor\");b.lineWidth=this.attr_(\"gridLineWidth\");for(var d=0;d<e.length;d++){if(e[d][0]!=0){continue}var a=c(this.area.x);var f=g(this.area.y+e[d][1]*this.area.h);b.beginPath();b.moveTo(a,f);b.lineTo(a+this.area.w,f);b.closePath();b.stroke()}}if(this.attr_(\"drawXGrid\")){var e=this.layout.xticks;b.save();b.strokeStyle=this.attr_(\"gridLineColor\");b.lineWidth=this.attr_(\"gridLineWidth\");for(var d=0;d<e.length;d++){var a=c(this.area.x+e[d][0]*this.area.w);var f=g(this.area.y+this.area.h);b.beginPath();b.moveTo(a,f);b.lineTo(a,this.area.y);b.closePath();b.stroke()}}this._renderLineChart();this._renderAxis();this._renderChartLabels();this._renderAnnotations()};DygraphCanvasRenderer.prototype._renderAxis=function(){if(!this.attr_(\"drawXAxis\")&&!this.attr_(\"drawYAxis\")){return}function b(i){return Math.round(i)+0.5}function e(i){return Math.round(i)-0.5}var c=this.elementContext;var k={position:\"absolute\",fontSize:this.attr_(\"axisLabelFontSize\")+\"px\",zIndex:10,color:this.attr_(\"axisLabelColor\"),width:this.attr_(\"axisLabelWidth\")+\"px\",overflow:\"hidden\"};var g=function(i,t){var u=document.createElement(\"div\");for(var s in k){if(k.hasOwnProperty(s)){u.style[s]=k[s]}}var r=document.createElement(\"div\");r.className=\"dygraph-axis-label dygraph-axis-label-\"+t;r.appendChild(document.createTextNode(i));u.appendChild(r);return u};c.save();c.strokeStyle=this.attr_(\"axisLineColor\");c.lineWidth=this.attr_(\"axisLineWidth\");if(this.attr_(\"drawYAxis\")){if(this.layout.yticks&&this.layout.yticks.length>0){for(var h=0;h<this.layout.yticks.length;h++){var j=this.layout.yticks[h];if(typeof(j)==\"function\"){return}var o=this.area.x;var f=1;if(j[0]==1){o=this.area.x+this.area.w;f=-1}var m=this.area.y+j[1]*this.area.h;c.beginPath();c.moveTo(b(o),e(m));c.lineTo(b(o-f*this.attr_(\"axisTickSize\")),e(m));c.closePath();c.stroke();var n=g(j[2],\"y\");var l=(m-this.attr_(\"axisLabelFontSize\")/2);if(l<0){l=0}if(l+this.attr_(\"axisLabelFontSize\")+3>this.height){n.style.bottom=\"0px\"}else{n.style.top=l+\"px\"}if(j[0]==0){n.style.left=(this.area.x-this.attr_(\"yAxisLabelWidth\")-this.attr_(\"axisTickSize\"))+\"px\";n.style.textAlign=\"right\"}else{if(j[0]==1){n.style.left=(this.area.x+this.area.w+this.attr_(\"axisTickSize\"))+\"px\";n.style.textAlign=\"left\"}}n.style.width=this.attr_(\"yAxisLabelWidth\")+\"px\";this.container.appendChild(n);this.ylabels.push(n)}var p=this.ylabels[0];var q=this.attr_(\"axisLabelFontSize\");var a=parseInt(p.style.top)+q;if(a>this.height-q){p.style.top=(parseInt(p.style.top)-q/2)+\"px\"}}c.beginPath();c.moveTo(b(this.area.x),e(this.area.y));c.lineTo(b(this.area.x),e(this.area.y+this.area.h));c.closePath();c.stroke();if(this.dygraph_.numAxes()==2){c.beginPath();c.moveTo(e(this.area.x+this.area.w),e(this.area.y));c.lineTo(e(this.area.x+this.area.w),e(this.area.y+this.area.h));c.closePath();c.stroke()}}if(this.attr_(\"drawXAxis\")){if(this.layout.xticks){for(var h=0;h<this.layout.xticks.length;h++){var j=this.layout.xticks[h];if(typeof(dataset)==\"function\"){return}var o=this.area.x+j[0]*this.area.w;var m=this.area.y+this.area.h;c.beginPath();c.moveTo(b(o),e(m));c.lineTo(b(o),e(m+this.attr_(\"axisTickSize\")));c.closePath();c.stroke();var n=g(j[1],\"x\");n.style.textAlign=\"center\";n.style.top=(m+this.attr_(\"axisTickSize\"))+\"px\";var d=(o-this.attr_(\"axisLabelWidth\")/2);if(d+this.attr_(\"axisLabelWidth\")>this.width){d=this.width-this.attr_(\"xAxisLabelWidth\");n.style.textAlign=\"right\"}if(d<0){d=0;n.style.textAlign=\"left\"}n.style.left=d+\"px\";n.style.width=this.attr_(\"xAxisLabelWidth\")+\"px\";this.container.appendChild(n);this.xlabels.push(n)}}c.beginPath();c.moveTo(b(this.area.x),e(this.area.y+this.area.h));c.lineTo(b(this.area.x+this.area.w),e(this.area.y+this.area.h));c.closePath();c.stroke()}c.restore()};DygraphCanvasRenderer.prototype._renderChartLabels=function(){if(this.attr_(\"title\")){var d=document.createElement(\"div\");d.style.position=\"absolute\";d.style.top=\"0px\";d.style.left=this.area.x+\"px\";d.style.width=this.area.w+\"px\";d.style.height=this.attr_(\"titleHeight\")+\"px\";d.style.textAlign=\"center\";d.style.fontSize=(this.attr_(\"titleHeight\")-8)+\"px\";d.style.fontWeight=\"bold\";var b=document.createElement(\"div\");b.className=\"dygraph-label dygraph-title\";b.innerHTML=this.attr_(\"title\");d.appendChild(b);this.container.appendChild(d);this.chartLabels.title=d}if(this.attr_(\"xlabel\")){var d=document.createElement(\"div\");d.style.position=\"absolute\";d.style.bottom=0;d.style.left=this.area.x+\"px\";d.style.width=this.area.w+\"px\";d.style.height=this.attr_(\"xLabelHeight\")+\"px\";d.style.textAlign=\"center\";d.style.fontSize=(this.attr_(\"xLabelHeight\")-2)+\"px\";var b=document.createElement(\"div\");b.className=\"dygraph-label dygraph-xlabel\";b.innerHTML=this.attr_(\"xlabel\");d.appendChild(b);this.container.appendChild(d);this.chartLabels.xlabel=d}if(this.attr_(\"ylabel\")){var c={left:0,top:this.area.y,width:this.attr_(\"yLabelWidth\"),height:this.area.h};var d=document.createElement(\"div\");d.style.position=\"absolute\";d.style.left=c.left;d.style.top=c.top+\"px\";d.style.width=c.width+\"px\";d.style.height=c.height+\"px\";d.style.fontSize=(this.attr_(\"yLabelWidth\")-2)+\"px\";var a=document.createElement(\"div\");a.style.position=\"absolute\";a.style.width=c.height+\"px\";a.style.height=c.width+\"px\";a.style.top=(c.height/2-c.width/2)+\"px\";a.style.left=(c.width/2-c.height/2)+\"px\";a.style.textAlign=\"center\";a.style.transform=\"rotate(-90deg)\";a.style.WebkitTransform=\"rotate(-90deg)\";a.style.MozTransform=\"rotate(-90deg)\";a.style.OTransform=\"rotate(-90deg)\";a.style.msTransform=\"rotate(-90deg)\";if(typeof(document.documentMode)!==\"undefined\"&&document.documentMode<9){a.style.filter=\"progid:DXImageTransform.Microsoft.BasicImage(rotation=3)\";a.style.left=\"0px\";a.style.top=\"0px\"}var b=document.createElement(\"div\");b.className=\"dygraph-label dygraph-ylabel\";b.innerHTML=this.attr_(\"ylabel\");a.appendChild(b);d.appendChild(a);this.container.appendChild(d);this.chartLabels.ylabel=d}};DygraphCanvasRenderer.prototype._renderAnnotations=function(){var h={position:\"absolute\",fontSize:this.attr_(\"axisLabelFontSize\")+\"px\",zIndex:10,overflow:\"hidden\"};var j=function(i,q,r,a){return function(s){var p=r.annotation;if(p.hasOwnProperty(i)){p[i](p,r,a.dygraph_,s)}else{if(a.dygraph_.attr_(q)){a.dygraph_.attr_(q)(p,r,a.dygraph_,s)}}}};var m=this.layout.annotated_points;for(var g=0;g<m.length;g++){var e=m[g];if(e.canvasx<this.area.x||e.canvasx>this.area.x+this.area.w){continue}var k=e.annotation;var l=6;if(k.hasOwnProperty(\"tickHeight\")){l=k.tickHeight}var c=document.createElement(\"div\");for(var b in h){if(h.hasOwnProperty(b)){c.style[b]=h[b]}}if(!k.hasOwnProperty(\"icon\")){c.className=\"dygraphDefaultAnnotation\"}if(k.hasOwnProperty(\"cssClass\")){c.className+=\" \"+k.cssClass}var d=k.hasOwnProperty(\"width\")?k.width:16;var n=k.hasOwnProperty(\"height\")?k.height:16;if(k.hasOwnProperty(\"icon\")){var f=document.createElement(\"img\");f.src=k.icon;f.width=d;f.height=n;c.appendChild(f)}else{if(e.annotation.hasOwnProperty(\"shortText\")){c.appendChild(document.createTextNode(e.annotation.shortText))}}c.style.left=(e.canvasx-d/2)+\"px\";if(k.attachAtBottom){c.style.top=(this.area.h-n-l)+\"px\"}else{c.style.top=(e.canvasy-n-l)+\"px\"}c.style.width=d+\"px\";c.style.height=n+\"px\";c.title=e.annotation.text;c.style.color=this.colors[e.name];c.style.borderColor=this.colors[e.name];k.div=c;Dygraph.addEvent(c,\"click\",j(\"clickHandler\",\"annotationClickHandler\",e,this));Dygraph.addEvent(c,\"mouseover\",j(\"mouseOverHandler\",\"annotationMouseOverHandler\",e,this));Dygraph.addEvent(c,\"mouseout\",j(\"mouseOutHandler\",\"annotationMouseOutHandler\",e,this));Dygraph.addEvent(c,\"dblclick\",j(\"dblClickHandler\",\"annotationDblClickHandler\",e,this));this.container.appendChild(c);this.annotations.push(c);var o=this.elementContext;o.strokeStyle=this.colors[e.name];o.beginPath();if(!k.attachAtBottom){o.moveTo(e.canvasx,e.canvasy);o.lineTo(e.canvasx,e.canvasy-2-l)}else{o.moveTo(e.canvasx,this.area.h);o.lineTo(e.canvasx,this.area.h-2-l)}o.closePath();o.stroke()}};DygraphCanvasRenderer.prototype._renderLineChart=function(){var d=this.elementContext;var y=this.attr_(\"fillAlpha\");var D=this.attr_(\"errorBars\")||this.attr_(\"customBars\");var r=this.attr_(\"fillGraph\");var e=this.attr_(\"stackedGraph\");var l=this.attr_(\"stepPlot\");var F=[];for(var G in this.layout.datasets){if(this.layout.datasets.hasOwnProperty(G)){F.push(G)}}var z=F.length;this.colors={};for(var B=0;B<z;B++){this.colors[F[B]]=this.colorScheme_[B%this.colorScheme_.length]}for(var B=0;B<this.layout.points.length;B++){var u=this.layout.points[B];u.canvasx=this.area.w*u.x+this.area.x;u.canvasy=this.area.h*u.y+this.area.y}var t=d;if(D){if(r){this.dygraph_.warn(\"Can't use fillGraph option with error bars\")}for(var B=0;B<z;B++){var h=F[B];var c=this.dygraph_.axisPropertiesForSeries(h);var w=this.colors[h];t.save();var k=NaN;var f=NaN;var g=[-1,-1];var C=c.yscale;var a=new RGBColor(w);var E=\"rgba(\"+a.r+\",\"+a.g+\",\"+a.b+\",\"+y+\")\";t.fillStyle=E;t.beginPath();for(var x=0;x<this.layout.points.length;x++){var u=this.layout.points[x];if(u.name==h){if(!Dygraph.isOK(u.y)){k=NaN;continue}if(l){var p=[f-u.errorPlus*C,f+u.errorMinus*C];f=u.y}else{var p=[u.y-u.errorPlus*C,u.y+u.errorMinus*C]}p[0]=this.area.h*p[0]+this.area.y;p[1]=this.area.h*p[1]+this.area.y;if(!isNaN(k)){if(l){t.moveTo(k,p[0])}else{t.moveTo(k,g[0])}t.lineTo(u.canvasx,p[0]);t.lineTo(u.canvasx,p[1]);if(l){t.lineTo(k,p[1])}else{t.lineTo(k,g[1])}t.closePath()}g=p;k=u.canvasx}}t.fill()}}else{if(r){var o=[];for(var B=z-1;B>=0;B--){var h=F[B];var w=this.colors[h];var c=this.dygraph_.axisPropertiesForSeries(h);var b=1+c.minyval*c.yscale;if(b<0){b=0}else{if(b>1){b=1}}b=this.area.h*b+this.area.y;t.save();var k=NaN;var g=[-1,-1];var C=c.yscale;var a=new RGBColor(w);var E=\"rgba(\"+a.r+\",\"+a.g+\",\"+a.b+\",\"+y+\")\";t.fillStyle=E;t.beginPath();for(var x=0;x<this.layout.points.length;x++){var u=this.layout.points[x];if(u.name==h){if(!Dygraph.isOK(u.y)){k=NaN;continue}var p;if(e){lastY=o[u.canvasx];if(lastY===undefined){lastY=b}o[u.canvasx]=u.canvasy;p=[u.canvasy,lastY]}else{p=[u.canvasy,b]}if(!isNaN(k)){t.moveTo(k,g[0]);if(l){t.lineTo(u.canvasx,g[0])}else{t.lineTo(u.canvasx,p[0])}t.lineTo(u.canvasx,p[1]);t.lineTo(k,g[1]);t.closePath()}g=p;k=u.canvasx}}t.fill()}}}var s=function(i){return(i===null||isNaN(i))};for(var B=0;B<z;B++){var h=F[B];var w=this.colors[h];var q=this.dygraph_.attr_(\"strokeWidth\",h);d.save();var u=this.layout.points[0];var m=this.dygraph_.attr_(\"pointSize\",h);var k=null,f=null;var v=this.dygraph_.attr_(\"drawPoints\",h);var A=this.layout.points;for(var x=0;x<A.length;x++){var u=A[x];if(u.name==h){if(s(u.canvasy)){if(l&&k!=null){t.beginPath();t.strokeStyle=w;t.lineWidth=this.attr_(\"strokeWidth\");t.moveTo(k,f);t.lineTo(u.canvasx,f);t.stroke()}k=f=null}else{var n=(!k&&(x==A.length-1||s(A[x+1].canvasy)));if(k===null){k=u.canvasx;f=u.canvasy}else{if(q){t.beginPath();t.strokeStyle=w;t.lineWidth=q;t.moveTo(k,f);if(l){t.lineTo(u.canvasx,f)}k=u.canvasx;f=u.canvasy;t.lineTo(k,f);t.stroke()}}if(v||n){t.beginPath();t.fillStyle=w;t.arc(u.canvasx,u.canvasy,m,0,2*Math.PI,false);t.fill()}}}}}d.restore()};Dygraph=function(c,b,a){if(arguments.length>0){if(arguments.length==4){this.warn(\"Using deprecated four-argument dygraph constructor\");this.__old_init__(c,b,arguments[2],arguments[3])}else{this.__init__(c,b,a)}}};Dygraph.NAME=\"Dygraph\";Dygraph.VERSION=\"1.2\";Dygraph.__repr__=function(){return\"[\"+this.NAME+\" \"+this.VERSION+\"]\"};Dygraph.toString=function(){return this.__repr__()};Dygraph.DEFAULT_ROLL_PERIOD=1;Dygraph.DEFAULT_WIDTH=480;Dygraph.DEFAULT_HEIGHT=320;Dygraph.DEFAULT_ATTRS={highlightCircleSize:3,pixelsPerXLabel:60,pixelsPerYLabel:30,labelsDivWidth:250,labelsDivStyles:{},labelsSeparateLines:false,labelsShowZeroValues:true,labelsKMB:false,labelsKMG2:false,showLabelsOnHighlight:true,yValueFormatter:function(d,c){return Dygraph.numberFormatter(d,c)},digitsAfterDecimal:2,maxNumberWidth:6,sigFigs:null,strokeWidth:1,axisTickSize:3,axisLabelFontSize:14,xAxisLabelWidth:50,yAxisLabelWidth:50,xAxisLabelFormatter:Dygraph.dateAxisFormatter,rightGap:5,showRoller:false,xValueFormatter:Dygraph.dateString_,xValueParser:Dygraph.dateParser,xTicker:Dygraph.dateTicker,delimiter:\",\",sigma:2,errorBars:false,fractions:false,wilsonInterval:true,customBars:false,fillGraph:false,fillAlpha:0.15,connectSeparatedPoints:false,stackedGraph:false,hideOverlayOnMouseOut:true,legend:\"onmouseover\",stepPlot:false,avoidMinZero:false,titleHeight:28,xLabelHeight:18,yLabelWidth:18,drawXAxis:true,drawYAxis:true,axisLineColor:\"black\",axisLineWidth:0.3,gridLineWidth:0.3,axisLabelColor:\"black\",axisLabelFont:\"Arial\",axisLabelWidth:50,drawYGrid:true,drawXGrid:true,gridLineColor:\"rgb(128,128,128)\",interactionModel:null};Dygraph.HORIZONTAL=1;Dygraph.VERTICAL=2;Dygraph.addedAnnotationCSS=false;Dygraph.prototype.__old_init__=function(f,d,e,b){if(e!=null){var a=[\"Date\"];for(var c=0;c<e.length;c++){a.push(e[c])}Dygraph.update(b,{labels:a})}this.__init__(f,d,b)};Dygraph.prototype.__init__=function(d,c,b){if(/MSIE/.test(navigator.userAgent)&&!window.opera&&typeof(G_vmlCanvasManager)!=\"undefined\"&&document.readyState!=\"complete\"){var a=this;setTimeout(function(){a.__init__(d,c,b)},100)}if(b==null){b={}}this.maindiv_=d;this.file_=c;this.rollPeriod_=b.rollPeriod||Dygraph.DEFAULT_ROLL_PERIOD;this.previousVerticalX_=-1;this.fractions_=b.fractions||false;this.dateWindow_=b.dateWindow||null;this.wilsonInterval_=b.wilsonInterval||true;this.is_initial_draw_=true;this.annotations_=[];this.zoomed_x_=false;this.zoomed_y_=false;d.innerHTML=\"\";if(d.style.width==\"\"){d.style.width=(b.width||Dygraph.DEFAULT_WIDTH)+\"px\"}if(d.style.height==\"\"){d.style.height=(b.height||Dygraph.DEFAULT_HEIGHT)+\"px\"}this.width_=parseInt(d.style.width,10);this.height_=parseInt(d.style.height,10);if(d.style.width.indexOf(\"%\")==d.style.width.length-1){this.width_=d.offsetWidth}if(d.style.height.indexOf(\"%\")==d.style.height.length-1){this.height_=d.offsetHeight}if(this.width_==0){this.error(\"dygraph has zero width. Please specify a width in pixels.\")}if(this.height_==0){this.error(\"dygraph has zero height. Please specify a height in pixels.\")}if(b.stackedGraph){b.fillGraph=true}this.user_attrs_={};Dygraph.update(this.user_attrs_,b);this.attrs_={};Dygraph.update(this.attrs_,Dygraph.DEFAULT_ATTRS);this.boundaryIds_=[];this.createInterface_();this.start_()};Dygraph.prototype.isZoomed=function(a){if(a==null){return this.zoomed_x_||this.zoomed_y_}if(a==\"x\"){return this.zoomed_x_}if(a==\"y\"){return this.zoomed_y_}throw\"axis parameter to Dygraph.isZoomed must be missing, 'x' or 'y'.\"};Dygraph.prototype.toString=function(){var a=this.maindiv_;var b=(a&&a.id)?a.id:a;return\"[Dygraph \"+b+\"]\"};Dygraph.prototype.attr_=function(b,a){if(a&&typeof(this.user_attrs_[a])!=\"undefined\"&&this.user_attrs_[a]!=null&&typeof(this.user_attrs_[a][b])!=\"undefined\"){return this.user_attrs_[a][b]}else{if(typeof(this.user_attrs_[b])!=\"undefined\"){return this.user_attrs_[b]}else{if(typeof(this.attrs_[b])!=\"undefined\"){return this.attrs_[b]}else{return null}}}};Dygraph.prototype.rollPeriod=function(){return this.rollPeriod_};Dygraph.prototype.xAxisRange=function(){return this.dateWindow_?this.dateWindow_:this.xAxisExtremes()};Dygraph.prototype.xAxisExtremes=function(){var b=this.rawData_[0][0];var a=this.rawData_[this.rawData_.length-1][0];return[b,a]};Dygraph.prototype.yAxisRange=function(a){if(typeof(a)==\"undefined\"){a=0}if(a<0||a>=this.axes_.length){return null}var b=this.axes_[a];return[b.computedValueRange[0],b.computedValueRange[1]]};Dygraph.prototype.yAxisRanges=function(){var a=[];for(var b=0;b<this.axes_.length;b++){a.push(this.yAxisRange(b))}return a};Dygraph.prototype.toDomCoords=function(a,c,b){return[this.toDomXCoord(a),this.toDomYCoord(c,b)]};Dygraph.prototype.toDomXCoord=function(b){if(b==null){return null}var c=this.plotter_.area;var a=this.xAxisRange();return c.x+(b-a[0])/(a[1]-a[0])*c.w};Dygraph.prototype.toDomYCoord=function(d,a){var c=this.toPercentYCoord(d,a);if(c==null){return null}var b=this.plotter_.area;return b.y+c*b.h};Dygraph.prototype.toDataCoords=function(a,c,b){return[this.toDataXCoord(a),this.toDataYCoord(c,b)]};Dygraph.prototype.toDataXCoord=function(b){if(b==null){return null}var c=this.plotter_.area;var a=this.xAxisRange();return a[0]+(b-c.x)/c.w*(a[1]-a[0])};Dygraph.prototype.toDataYCoord=function(h,b){if(h==null){return null}var c=this.plotter_.area;var g=this.yAxisRange(b);if(typeof(b)==\"undefined\"){b=0}if(!this.axes_[b].logscale){return g[0]+(c.y+c.h-h)/c.h*(g[1]-g[0])}else{var f=(h-c.y)/c.h;var a=Dygraph.log10(g[1]);var e=a-(f*(a-Dygraph.log10(g[0])));var d=Math.pow(Dygraph.LOG_SCALE,e);return d}};Dygraph.prototype.toPercentYCoord=function(f,b){if(f==null){return null}if(typeof(b)==\"undefined\"){b=0}var c=this.plotter_.area;var e=this.yAxisRange(b);var d;if(!this.axes_[b].logscale){d=(e[1]-f)/(e[1]-e[0])}else{var a=Dygraph.log10(e[1]);d=(a-Dygraph.log10(f))/(a-Dygraph.log10(e[0]))}return d};Dygraph.prototype.toPercentXCoord=function(b){if(b==null){return null}var a=this.xAxisRange();return(b-a[0])/(a[1]-a[0])};Dygraph.prototype.numColumns=function(){return this.rawData_[0].length};Dygraph.prototype.numRows=function(){return this.rawData_.length};Dygraph.prototype.getValue=function(b,a){if(b<0||b>this.rawData_.length){return null}if(a<0||a>this.rawData_[b].length){return null}return this.rawData_[b][a]};Dygraph.prototype.createInterface_=function(){var a=this.maindiv_;this.graphDiv=document.createElement(\"div\");this.graphDiv.style.width=this.width_+\"px\";this.graphDiv.style.height=this.height_+\"px\";a.appendChild(this.graphDiv);this.canvas_=Dygraph.createCanvas();this.canvas_.style.position=\"absolute\";this.canvas_.width=this.width_;this.canvas_.height=this.height_;this.canvas_.style.width=this.width_+\"px\";this.canvas_.style.height=this.height_+\"px\";this.canvas_ctx_=Dygraph.getContext(this.canvas_);this.hidden_=this.createPlotKitCanvas_(this.canvas_);this.hidden_ctx_=Dygraph.getContext(this.hidden_);this.graphDiv.appendChild(this.hidden_);this.graphDiv.appendChild(this.canvas_);this.mouseEventElement_=this.canvas_;var b=this;Dygraph.addEvent(this.mouseEventElement_,\"mousemove\",function(c){b.mouseMove_(c)});Dygraph.addEvent(this.mouseEventElement_,\"mouseout\",function(c){b.mouseOut_(c)});this.layout_=new DygraphLayout(this);this.createStatusMessage_();this.createDragInterface_()};Dygraph.prototype.destroy=function(){var a=function(c){while(c.hasChildNodes()){a(c.firstChild);c.removeChild(c.firstChild)}};a(this.maindiv_);var b=function(c){for(var d in c){if(typeof(c[d])===\"object\"){c[d]=null}}};b(this.layout_);b(this.plotter_);b(this)};Dygraph.prototype.createPlotKitCanvas_=function(a){var b=Dygraph.createCanvas();b.style.position=\"absolute\";b.style.top=a.style.top;b.style.left=a.style.left;b.width=this.width_;b.height=this.height_;b.style.width=this.width_+\"px\";b.style.height=this.height_+\"px\";return b};Dygraph.prototype.setColors_=function(){var e=this.attr_(\"labels\").length-1;this.colors_=[];var a=this.attr_(\"colors\");if(!a){var c=this.attr_(\"colorSaturation\")||1;var b=this.attr_(\"colorValue\")||0.5;var j=Math.ceil(e/2);for(var d=1;d<=e;d++){if(!this.visibility()[d-1]){continue}var g=d%2?Math.ceil(d/2):(j+d/2);var f=(1*g/(1+e));this.colors_.push(Dygraph.hsvToRGB(f,c,b))}}else{for(var d=0;d<e;d++){if(!this.visibility()[d]){continue}var h=a[d%a.length];this.colors_.push(h)}}this.plotter_.setColors(this.colors_)};Dygraph.prototype.getColors=function(){return this.colors_};Dygraph.prototype.createStatusMessage_=function(){var d=this.user_attrs_.labelsDiv;if(d&&null!=d&&(typeof(d)==\"string\"||d instanceof String)){this.user_attrs_.labelsDiv=document.getElementById(d)}if(!this.attr_(\"labelsDiv\")){var a=this.attr_(\"labelsDivWidth\");var c={position:\"absolute\",fontSize:\"14px\",zIndex:10,width:a+\"px\",top:\"0px\",left:(this.width_-a-2)+\"px\",background:\"white\",textAlign:\"left\",overflow:\"hidden\"};Dygraph.update(c,this.attr_(\"labelsDivStyles\"));var e=document.createElement(\"div\");for(var b in c){if(c.hasOwnProperty(b)){e.style[b]=c[b]}}this.graphDiv.appendChild(e);this.attrs_.labelsDiv=e}};Dygraph.prototype.positionLabelsDiv_=function(){if(this.user_attrs_.hasOwnProperty(\"labelsDiv\")){return}var a=this.plotter_.area;var b=this.attr_(\"labelsDiv\");b.style.left=a.x+a.w-this.attr_(\"labelsDivWidth\")-1+\"px\";b.style.top=a.y+\"px\"};Dygraph.prototype.createRollInterface_=function(){if(!this.roller_){this.roller_=document.createElement(\"input\");this.roller_.type=\"text\";this.roller_.style.display=\"none\";this.graphDiv.appendChild(this.roller_)}var e=this.attr_(\"showRoller\")?\"block\":\"none\";var d=this.plotter_.area;var b={position:\"absolute\",zIndex:10,top:(d.y+d.h-25)+\"px\",left:(d.x+1)+\"px\",display:e};this.roller_.size=\"2\";this.roller_.value=this.rollPeriod_;for(var a in b){if(b.hasOwnProperty(a)){this.roller_.style[a]=b[a]}}var c=this;this.roller_.onchange=function(){c.adjustRoll(c.roller_.value)}};Dygraph.prototype.dragGetX_=function(b,a){return Dygraph.pageX(b)-a.px};Dygraph.prototype.dragGetY_=function(b,a){return Dygraph.pageY(b)-a.py};Dygraph.prototype.createDragInterface_=function(){var c={isZooming:false,isPanning:false,is2DPan:false,dragStartX:null,dragStartY:null,dragEndX:null,dragEndY:null,dragDirection:null,prevEndX:null,prevEndY:null,prevDragDirection:null,initialLeftmostDate:null,xUnitsPerPixel:null,dateRange:null,px:0,py:0,boundedDates:null,boundedValues:null,initializeMouseDown:function(i,h,f){if(i.preventDefault){i.preventDefault()}else{i.returnValue=false;i.cancelBubble=true}f.px=Dygraph.findPosX(h.canvas_);f.py=Dygraph.findPosY(h.canvas_);f.dragStartX=h.dragGetX_(i,f);f.dragStartY=h.dragGetY_(i,f)}};var e=this.attr_(\"interactionModel\");var b=this;var d=function(f){return function(g){f(g,b,c)}};for(var a in e){if(!e.hasOwnProperty(a)){continue}Dygraph.addEvent(this.mouseEventElement_,a,d(e[a]))}Dygraph.addEvent(document,\"mouseup\",function(g){if(c.isZooming||c.isPanning){c.isZooming=false;c.dragStartX=null;c.dragStartY=null}if(c.isPanning){c.isPanning=false;c.draggingDate=null;c.dateRange=null;for(var f=0;f<b.axes_.length;f++){delete b.axes_[f].draggingValue;delete b.axes_[f].dragValueRange}}})};Dygraph.prototype.drawZoomRect_=function(e,c,i,b,g,a,f,d){var h=this.canvas_ctx_;if(a==Dygraph.HORIZONTAL){h.clearRect(Math.min(c,f),0,Math.abs(c-f),this.height_)}else{if(a==Dygraph.VERTICAL){h.clearRect(0,Math.min(b,d),this.width_,Math.abs(b-d))}}if(e==Dygraph.HORIZONTAL){if(i&&c){h.fillStyle=\"rgba(128,128,128,0.33)\";h.fillRect(Math.min(c,i),0,Math.abs(i-c),this.height_)}}if(e==Dygraph.VERTICAL){if(g&&b){h.fillStyle=\"rgba(128,128,128,0.33)\";h.fillRect(0,Math.min(b,g),this.width_,Math.abs(g-b))}}};Dygraph.prototype.doZoomX_=function(c,a){var b=this.toDataXCoord(c);var d=this.toDataXCoord(a);this.doZoomXDates_(b,d)};Dygraph.prototype.doZoomXDates_=function(a,b){this.dateWindow_=[a,b];this.zoomed_x_=true;this.drawGraph_();if(this.attr_(\"zoomCallback\")){this.attr_(\"zoomCallback\")(a,b,this.yAxisRanges())}};Dygraph.prototype.doZoomY_=function(g,f){var c=[];for(var e=0;e<this.axes_.length;e++){var d=this.toDataYCoord(g,e);var b=this.toDataYCoord(f,e);this.axes_[e].valueWindow=[b,d];c.push([b,d])}this.zoomed_y_=true;this.drawGraph_();if(this.attr_(\"zoomCallback\")){var a=this.xAxisRange();var h=this.yAxisRange();this.attr_(\"zoomCallback\")(a[0],a[1],this.yAxisRanges())}};Dygraph.prototype.doUnzoom_=function(){var b=false;if(this.dateWindow_!=null){b=true;this.dateWindow_=null}for(var a=0;a<this.axes_.length;a++){if(this.axes_[a].valueWindow!=null){b=true;delete this.axes_[a].valueWindow}}this.clearSelection();if(b){this.zoomed_x_=false;this.zoomed_y_=false;this.drawGraph_();if(this.attr_(\"zoomCallback\")){var c=this.rawData_[0][0];var d=this.rawData_[this.rawData_.length-1][0];this.attr_(\"zoomCallback\")(c,d,this.yAxisRanges())}}};Dygraph.prototype.mouseMove_=function(b){var s=this.layout_.points;if(s===undefined){return}var a=Dygraph.pageX(b)-Dygraph.findPosX(this.mouseEventElement_);var m=-1;var j=-1;var q=1e+100;var r=-1;for(var f=0;f<s.length;f++){var o=s[f];if(o==null){continue}var h=Math.abs(o.canvasx-a);if(h>q){continue}q=h;r=f}if(r>=0){m=s[r].xval}this.selPoints_=[];var d=s.length;if(!this.attr_(\"stackedGraph\")){for(var f=0;f<d;f++){if(s[f].xval==m){this.selPoints_.push(s[f])}}}else{var g=0;for(var f=d-1;f>=0;f--){if(s[f].xval==m){var c={};for(var e in s[f]){c[e]=s[f][e]}c.yval-=g;g+=c.yval;this.selPoints_.push(c)}}this.selPoints_.reverse()}if(this.attr_(\"highlightCallback\")){var n=this.lastx_;if(n!==null&&m!=n){this.attr_(\"highlightCallback\")(b,m,this.selPoints_,this.idxToRow_(r))}}this.lastx_=m;this.updateSelection_()};Dygraph.prototype.idxToRow_=function(a){if(a<0){return -1}for(var b in this.layout_.datasets){if(a<this.layout_.datasets[b].length){return this.boundaryIds_[0][0]+a}a-=this.layout_.datasets[b].length}return -1};Dygraph.prototype.generateLegendHTML_=function(j,k){if(typeof(j)===\"undefined\"){if(this.attr_(\"legend\")!=\"always\"){return\"\"}var a=this.attr_(\"labelsSeparateLines\");var f=this.attr_(\"labels\");var e=\"\";for(var d=1;d<f.length;d++){if(!this.visibility()[d-1]){continue}var h=this.plotter_.colors[f[d]];if(e!=\"\"){e+=(a?\"<br/>\":\" \")}e+=\"<b><span style='color: \"+h+\";'>&mdash;\"+f[d]+\"</span></b>\"}return e}var e=this.attr_(\"xValueFormatter\")(j)+\":\";var b=this.attr_(\"yValueFormatter\");var l=this.attr_(\"labelsShowZeroValues\");var a=this.attr_(\"labelsSeparateLines\");for(var d=0;d<this.selPoints_.length;d++){var m=this.selPoints_[d];if(m.yval==0&&!l){continue}if(!Dygraph.isOK(m.canvasy)){continue}if(a){e+=\"<br/>\"}var h=this.plotter_.colors[m.name];var g=b(m.yval,this);e+=\" <b><span style='color: \"+h+\";'>\"+m.name+\"</span></b>:\"+g}return e};Dygraph.prototype.setLegendHTML_=function(a,d){var c=this.generateLegendHTML_(a,d);var b=this.attr_(\"labelsDiv\");if(b!==null){b.innerHTML=c}else{if(typeof(this.shown_legend_error_)==\"undefined\"){this.error(\"labelsDiv is set to something nonexistent; legend will not be shown.\");this.shown_legend_error_=true}}};Dygraph.prototype.updateSelection_=function(){var h=this.canvas_ctx_;if(this.previousVerticalX_>=0){var e=0;var f=this.attr_(\"labels\");for(var d=1;d<f.length;d++){var b=this.attr_(\"highlightCircleSize\",f[d]);if(b>e){e=b}}var g=this.previousVerticalX_;h.clearRect(g-e-1,0,2*e+2,this.height_)}if(this.selPoints_.length>0){if(this.attr_(\"showLabelsOnHighlight\")){this.setLegendHTML_(this.lastx_,this.selPoints_)}var c=this.selPoints_[0].canvasx;h.save();for(var d=0;d<this.selPoints_.length;d++){var j=this.selPoints_[d];if(!Dygraph.isOK(j.canvasy)){continue}var a=this.attr_(\"highlightCircleSize\",j.name);h.beginPath();h.fillStyle=this.plotter_.colors[j.name];h.arc(c,j.canvasy,a,0,2*Math.PI,false);h.fill()}h.restore();this.previousVerticalX_=c}};Dygraph.prototype.setSelection=function(c){this.selPoints_=[];var d=0;if(c!==false){c=c-this.boundaryIds_[0][0]}if(c!==false&&c>=0){for(var b in this.layout_.datasets){if(c<this.layout_.datasets[b].length){var a=this.layout_.points[d+c];if(this.attr_(\"stackedGraph\")){a=this.layout_.unstackPointAtIndex(d+c)}this.selPoints_.push(a)}d+=this.layout_.datasets[b].length}}if(this.selPoints_.length){this.lastx_=this.selPoints_[0].xval;this.updateSelection_()}else{this.clearSelection()}};Dygraph.prototype.mouseOut_=function(a){if(this.attr_(\"unhighlightCallback\")){this.attr_(\"unhighlightCallback\")(a)}if(this.attr_(\"hideOverlayOnMouseOut\")){this.clearSelection()}};Dygraph.prototype.clearSelection=function(){this.canvas_ctx_.clearRect(0,0,this.width_,this.height_);this.setLegendHTML_();this.selPoints_=[];this.lastx_=-1};Dygraph.prototype.getSelection=function(){if(!this.selPoints_||this.selPoints_.length<1){return -1}for(var a=0;a<this.layout_.points.length;a++){if(this.layout_.points[a].x==this.selPoints_[0].x){return a+this.boundaryIds_[0][0]}}return -1};Dygraph.numberFormatter=function(a,d){var b=d.attr_(\"sigFigs\");if(b!==null){return Dygraph.floatFormat(a,b)}var e=d.attr_(\"digitsAfterDecimal\");var c=d.attr_(\"maxNumberWidth\");if(a!==0&&(Math.abs(a)>=Math.pow(10,c)||Math.abs(a)<Math.pow(10,-e))){return a.toExponential(e)}else{return\"\"+Dygraph.round_(a,e)}};Dygraph.dateAxisFormatter=function(b,c){if(c>=Dygraph.DECADAL){return b.strftime(\"%Y\")}else{if(c>=Dygraph.MONTHLY){return b.strftime(\"%b %y\")}else{var a=b.getHours()*3600+b.getMinutes()*60+b.getSeconds()+b.getMilliseconds();if(a==0||c>=Dygraph.DAILY){return new Date(b.getTime()+3600*1000).strftime(\"%d%b\")}else{return Dygraph.hmsString_(b.getTime())}}}};Dygraph.prototype.loadedEvent_=function(a){this.rawData_=this.parseCSV_(a);this.predraw_()};Dygraph.prototype.months=[\"Jan\",\"Feb\",\"Mar\",\"Apr\",\"May\",\"Jun\",\"Jul\",\"Aug\",\"Sep\",\"Oct\",\"Nov\",\"Dec\"];Dygraph.prototype.quarters=[\"Jan\",\"Apr\",\"Jul\",\"Oct\"];Dygraph.prototype.addXTicks_=function(){var a;if(this.dateWindow_){a=[this.dateWindow_[0],this.dateWindow_[1]]}else{a=[this.rawData_[0][0],this.rawData_[this.rawData_.length-1][0]]}var b=this.attr_(\"xTicker\")(a[0],a[1],this);this.layout_.setXTicks(b)};Dygraph.SECONDLY=0;Dygraph.TWO_SECONDLY=1;Dygraph.FIVE_SECONDLY=2;Dygraph.TEN_SECONDLY=3;Dygraph.THIRTY_SECONDLY=4;Dygraph.MINUTELY=5;Dygraph.TWO_MINUTELY=6;Dygraph.FIVE_MINUTELY=7;Dygraph.TEN_MINUTELY=8;Dygraph.THIRTY_MINUTELY=9;Dygraph.HOURLY=10;Dygraph.TWO_HOURLY=11;Dygraph.SIX_HOURLY=12;Dygraph.DAILY=13;Dygraph.WEEKLY=14;Dygraph.MONTHLY=15;Dygraph.QUARTERLY=16;Dygraph.BIANNUAL=17;Dygraph.ANNUAL=18;Dygraph.DECADAL=19;Dygraph.CENTENNIAL=20;Dygraph.NUM_GRANULARITIES=21;Dygraph.SHORT_SPACINGS=[];Dygraph.SHORT_SPACINGS[Dygraph.SECONDLY]=1000*1;Dygraph.SHORT_SPACINGS[Dygraph.TWO_SECONDLY]=1000*2;Dygraph.SHORT_SPACINGS[Dygraph.FIVE_SECONDLY]=1000*5;Dygraph.SHORT_SPACINGS[Dygraph.TEN_SECONDLY]=1000*10;Dygraph.SHORT_SPACINGS[Dygraph.THIRTY_SECONDLY]=1000*30;Dygraph.SHORT_SPACINGS[Dygraph.MINUTELY]=1000*60;Dygraph.SHORT_SPACINGS[Dygraph.TWO_MINUTELY]=1000*60*2;Dygraph.SHORT_SPACINGS[Dygraph.FIVE_MINUTELY]=1000*60*5;Dygraph.SHORT_SPACINGS[Dygraph.TEN_MINUTELY]=1000*60*10;Dygraph.SHORT_SPACINGS[Dygraph.THIRTY_MINUTELY]=1000*60*30;Dygraph.SHORT_SPACINGS[Dygraph.HOURLY]=1000*3600;Dygraph.SHORT_SPACINGS[Dygraph.TWO_HOURLY]=1000*3600*2;Dygraph.SHORT_SPACINGS[Dygraph.SIX_HOURLY]=1000*3600*6;Dygraph.SHORT_SPACINGS[Dygraph.DAILY]=1000*86400;Dygraph.SHORT_SPACINGS[Dygraph.WEEKLY]=1000*604800;Dygraph.prototype.NumXTicks=function(e,b,g){if(g<Dygraph.MONTHLY){var h=Dygraph.SHORT_SPACINGS[g];return Math.floor(0.5+1*(b-e)/h)}else{var f=1;var d=12;if(g==Dygraph.QUARTERLY){d=3}if(g==Dygraph.BIANNUAL){d=2}if(g==Dygraph.ANNUAL){d=1}if(g==Dygraph.DECADAL){d=1;f=10}if(g==Dygraph.CENTENNIAL){d=1;f=100}var c=365.2524*24*3600*1000;var a=1*(b-e)/c;return Math.floor(0.5+1*a*d/f)}};Dygraph.prototype.GetXAxis=function(m,h,a){var r=this.attr_(\"xAxisLabelFormatter\");var y=[];if(a<Dygraph.MONTHLY){var c=Dygraph.SHORT_SPACINGS[a];var u=\"%d%b\";var v=c/1000;var w=new Date(m);if(v<=60){var f=w.getSeconds();w.setSeconds(f-f%v)}else{w.setSeconds(0);v/=60;if(v<=60){var f=w.getMinutes();w.setMinutes(f-f%v)}else{w.setMinutes(0);v/=60;if(v<=24){var f=w.getHours();w.setHours(f-f%v)}else{w.setHours(0);v/=24;if(v==7){w.setDate(w.getDate()-w.getDay())}}}}m=w.getTime();for(var k=m;k<=h;k+=c){y.push({v:k,label:r(new Date(k),a)})}}else{var e;var n=1;if(a==Dygraph.MONTHLY){e=[0,1,2,3,4,5,6,7,8,9,10,11,12]}else{if(a==Dygraph.QUARTERLY){e=[0,3,6,9]}else{if(a==Dygraph.BIANNUAL){e=[0,6]}else{if(a==Dygraph.ANNUAL){e=[0]}else{if(a==Dygraph.DECADAL){e=[0];n=10}else{if(a==Dygraph.CENTENNIAL){e=[0];n=100}else{this.warn(\"Span of dates is too long\")}}}}}}var q=new Date(m).getFullYear();var o=new Date(h).getFullYear();var b=Dygraph.zeropad;for(var s=q;s<=o;s++){if(s%n!=0){continue}for(var p=0;p<e.length;p++){var l=s+\"/\"+b(1+e[p])+\"/01\";var k=Dygraph.dateStrToMillis(l);if(k<m||k>h){continue}y.push({v:k,label:r(new Date(k),a)})}}}return y};Dygraph.dateTicker=function(a,f,d){var b=-1;for(var e=0;e<Dygraph.NUM_GRANULARITIES;e++){var c=d.NumXTicks(a,f,e);if(d.width_/c>=d.attr_(\"pixelsPerXLabel\")){b=e;break}}if(b>=0){return d.GetXAxis(a,f,b)}else{}};Dygraph.PREFERRED_LOG_TICK_VALUES=function(){var c=[];for(var b=-39;b<=39;b++){var a=Math.pow(10,b);for(var d=1;d<=9;d++){var e=a*d;c.push(e)}}return c}();Dygraph.numericTicks=function(G,F,s,c,m){var w=function(i){if(c&&c.hasOwnProperty(i)){return c[i]}return s.attr_(i)};var H=[];if(m){for(var C=0;C<m.length;C++){H.push({v:m[C]})}}else{if(c&&w(\"logscale\")){var r=w(\"pixelsPerYLabel\");var y=Math.floor(s.height_/r);var g=Dygraph.binarySearch(G,Dygraph.PREFERRED_LOG_TICK_VALUES,1);var I=Dygraph.binarySearch(F,Dygraph.PREFERRED_LOG_TICK_VALUES,-1);if(g==-1){g=0}if(I==-1){I=Dygraph.PREFERRED_LOG_TICK_VALUES.length-1}var q=null;if(I-g>=y/4){var E=c.yAxisId;for(var p=I;p>=g;p--){var h=Dygraph.PREFERRED_LOG_TICK_VALUES[p];var t=c.g.toDomYCoord(h,E);var D={v:h};if(q==null){q={tickValue:h,domCoord:t}}else{if(t-q.domCoord>=r){q={tickValue:h,domCoord:t}}else{D.label=\"\"}}H.push(D)}H.reverse()}}if(H.length==0){if(w(\"labelsKMG2\")){var l=[1,2,4,8]}else{var l=[1,2,5]}var J,x,a,y;var r=w(\"pixelsPerYLabel\");for(var C=-10;C<50;C++){if(w(\"labelsKMG2\")){var e=Math.pow(16,C)}else{var e=Math.pow(10,C)}for(var A=0;A<l.length;A++){J=e*l[A];x=Math.floor(G/J)*J;a=Math.ceil(F/J)*J;y=Math.abs(a-x)/J;var d=s.height_/y;if(d>r){break}}if(d>r){break}}if(x>a){J*=-1}for(var C=0;C<y;C++){var o=x+C*J;H.push({v:o})}}}var z;var v=[];if(w(\"labelsKMB\")){z=1000;v=[\"K\",\"M\",\"B\",\"T\"]}if(w(\"labelsKMG2\")){if(z){s.warn(\"Setting both labelsKMB and labelsKMG2. Pick one!\")}z=1024;v=[\"k\",\"M\",\"G\",\"T\"]}var B=w(\"yAxisLabelFormatter\")?w(\"yAxisLabelFormatter\"):w(\"yValueFormatter\");for(var C=0;C<H.length;C++){if(H[C].label!==undefined){continue}var o=H[C].v;var b=Math.abs(o);var f=B(o,s);if(v.length>0){var u=z*z*z*z;for(var A=3;A>=0;A--,u/=z){if(b>=u){f=Dygraph.round_(o/u,w(\"digitsAfterDecimal\"))+v[A];break}}}H[C].label=f}return H};Dygraph.prototype.extremeValues_=function(d){var h=null,f=null;var b=this.attr_(\"errorBars\")||this.attr_(\"customBars\");if(b){for(var c=0;c<d.length;c++){var g=d[c][1][0];if(!g){continue}var a=g-d[c][1][1];var e=g+d[c][1][2];if(a>g){a=g}if(e<g){e=g}if(f==null||e>f){f=e}if(h==null||a<h){h=a}}}else{for(var c=0;c<d.length;c++){var g=d[c][1];if(g===null||isNaN(g)){continue}if(f==null||g>f){f=g}if(h==null||g<h){h=g}}}return[h,f]};Dygraph.prototype.predraw_=function(){this.computeYAxes_();if(this.plotter_){this.plotter_.clear()}this.plotter_=new DygraphCanvasRenderer(this,this.hidden_,this.hidden_ctx_,this.layout_);this.createRollInterface_();this.positionLabelsDiv_();this.drawGraph_()};Dygraph.prototype.drawGraph_=function(v){if(typeof(v)===\"undefined\"){v=true}var E=this.rawData_;var o=this.is_initial_draw_;this.is_initial_draw_=false;var B=null,A=null;this.layout_.removeAllDatasets();this.setColors_();this.attrs_.pointSize=0.5*this.attr_(\"highlightCircleSize\");var d=[];var f=[];var a={};for(var y=E[0].length-1;y>=1;y--){if(!this.visibility()[y-1]){continue}var z=this.attr_(\"labels\")[y];var c=this.attr_(\"connectSeparatedPoints\",y);var b=this.attr_(\"logscale\",y);var m=[];for(var w=0;w<E.length;w++){var C=E[w][0];var t=E[w][y];if(b){if(t<=0){t=null}m.push([C,t])}else{if(t!=null||!c){m.push([C,t])}}}m=this.rollingAverage(m,this.rollPeriod_);var r=this.attr_(\"errorBars\")||this.attr_(\"customBars\");if(this.dateWindow_){var G=this.dateWindow_[0];var g=this.dateWindow_[1];var q=[];var e=null,F=null;for(var u=0;u<m.length;u++){if(m[u][0]>=G&&e===null){e=u}if(m[u][0]<=g){F=u}}if(e===null){e=0}if(e>0){e--}if(F===null){F=m.length-1}if(F<m.length-1){F++}this.boundaryIds_[y-1]=[e,F];for(var u=e;u<=F;u++){q.push(m[u])}m=q}else{this.boundaryIds_[y-1]=[0,m.length-1]}var n=this.extremeValues_(m);if(r){for(var w=0;w<m.length;w++){val=[m[w][0],m[w][1][0],m[w][1][1],m[w][1][2]];m[w]=val}}else{if(this.attr_(\"stackedGraph\")){var s=m.length;var D;for(var w=0;w<s;w++){var h=m[w][0];if(d[h]===undefined){d[h]=0}D=m[w][1];d[h]+=D;m[w]=[h,d[h]];if(d[h]>n[1]){n[1]=d[h]}if(d[h]<n[0]){n[0]=d[h]}}}}a[z]=n;f[y]=m}for(var y=1;y<f.length;y++){if(!this.visibility()[y-1]){continue}this.layout_.addDataset(this.attr_(\"labels\")[y],f[y])}this.computeYAxisRanges_(a);this.layout_.setYAxes(this.axes_);this.addXTicks_();var p=this.zoomed_x_;this.layout_.setDateWindow(this.dateWindow_);this.zoomed_x_=p;this.layout_.evaluateWithError();this.plotter_.clear();this.plotter_.render();this.canvas_.getContext(\"2d\").clearRect(0,0,this.canvas_.width,this.canvas_.height);if(o){this.setLegendHTML_()}else{if(v){if(typeof(this.selPoints_)!==\"undefined\"&&this.selPoints_.length){this.clearSelection()}else{this.clearSelection()}}}if(this.attr_(\"drawCallback\")!==null){this.attr_(\"drawCallback\")(this,o)}};Dygraph.prototype.computeYAxes_=function(){var d;if(this.axes_!=undefined&&this.user_attrs_.hasOwnProperty(\"valueRange\")==false){d=[];for(var l=0;l<this.axes_.length;l++){d.push(this.axes_[l].valueWindow)}}this.axes_=[{yAxisId:0,g:this}];this.seriesToAxisMap_={};var j=this.attr_(\"labels\");var g={};for(var h=1;h<j.length;h++){g[j[h]]=(h-1)}var f=[\"includeZero\",\"valueRange\",\"labelsKMB\",\"labelsKMG2\",\"pixelsPerYLabel\",\"yAxisLabelWidth\",\"axisLabelFontSize\",\"axisTickSize\",\"logscale\"];for(var h=0;h<f.length;h++){var e=f[h];var q=this.attr_(e);if(q){this.axes_[0][e]=q}}for(var m in g){if(!g.hasOwnProperty(m)){continue}var c=this.attr_(\"axis\",m);if(c==null){this.seriesToAxisMap_[m]=0;continue}if(typeof(c)==\"object\"){var a={};Dygraph.update(a,this.axes_[0]);Dygraph.update(a,{valueRange:null});var p=this.axes_.length;a.yAxisId=p;a.g=this;Dygraph.update(a,c);this.axes_.push(a);this.seriesToAxisMap_[m]=p}}for(var m in g){if(!g.hasOwnProperty(m)){continue}var c=this.attr_(\"axis\",m);if(typeof(c)==\"string\"){if(!this.seriesToAxisMap_.hasOwnProperty(c)){this.error(\"Series \"+m+\" wants to share a y-axis with series \"+c+\", which does not define its own axis.\");return null}var n=this.seriesToAxisMap_[c];this.seriesToAxisMap_[m]=n}}var o={};var b=this.visibility();for(var h=1;h<j.length;h++){var r=j[h];if(b[h-1]){o[r]=this.seriesToAxisMap_[r]}}this.seriesToAxisMap_=o;if(d!=undefined){for(var l=0;l<d.length;l++){this.axes_[l].valueWindow=d[l]}}};Dygraph.prototype.numAxes=function(){var c=0;for(var b in this.seriesToAxisMap_){if(!this.seriesToAxisMap_.hasOwnProperty(b)){continue}var a=this.seriesToAxisMap_[b];if(a>c){c=a}}return 1+c};Dygraph.prototype.axisPropertiesForSeries=function(a){return this.axes_[this.seriesToAxisMap_[a]]};Dygraph.prototype.computeYAxisRanges_=function(a){var g=[];for(var h in this.seriesToAxisMap_){if(!this.seriesToAxisMap_.hasOwnProperty(h)){continue}var o=this.seriesToAxisMap_[h];while(g.length<=o){g.push([])}g[o].push(h)}for(var t=0;t<this.axes_.length;t++){var b=this.axes_[t];if(!g[t]){b.extremeRange=[0,1]}else{var h=g[t];var w=Infinity;var v=-Infinity;var n,m;for(var r=0;r<h.length;r++){n=a[h[r]][0];if(n!=null){w=Math.min(n,w)}m=a[h[r]][1];if(m!=null){v=Math.max(m,v)}}if(b.includeZero&&w>0){w=0}if(w==Infinity){w=0}if(v==-Infinity){v=0}var s=v-w;if(s==0){s=v}var d;var x;if(b.logscale){var d=v+0.1*s;var x=w}else{var d=v+0.1*s;var x=w-0.1*s;if(!this.attr_(\"avoidMinZero\")){if(x<0&&w>=0){x=0}if(d>0&&v<=0){d=0}}if(this.attr_(\"includeZero\")){if(v<0){d=0}if(w>0){x=0}}}b.extremeRange=[x,d]}if(b.valueWindow){b.computedValueRange=[b.valueWindow[0],b.valueWindow[1]]}else{if(b.valueRange){b.computedValueRange=[b.valueRange[0],b.valueRange[1]]}else{b.computedValueRange=b.extremeRange}}if(t==0||b.independentTicks){b.ticks=Dygraph.numericTicks(b.computedValueRange[0],b.computedValueRange[1],this,b)}else{var l=this.axes_[0];var e=l.ticks;var f=l.computedValueRange[1]-l.computedValueRange[0];var y=b.computedValueRange[1]-b.computedValueRange[0];var c=[];for(var q=0;q<e.length;q++){var p=(e[q].v-l.computedValueRange[0])/f;var u=b.computedValueRange[0]+p*y;c.push(u)}b.ticks=Dygraph.numericTicks(b.computedValueRange[0],b.computedValueRange[1],this,b,c)}}};Dygraph.prototype.rollingAverage=function(m,d){if(m.length<2){return m}var d=Math.min(d,m.length-1);var b=[];var s=this.attr_(\"sigma\");if(this.fractions_){var k=0;var h=0;var e=100;for(var x=0;x<m.length;x++){k+=m[x][1][0];h+=m[x][1][1];if(x-d>=0){k-=m[x-d][1][0];h-=m[x-d][1][1]}var B=m[x][0];var v=h?k/h:0;if(this.attr_(\"errorBars\")){if(this.wilsonInterval_){if(h){var t=v<0?0:v,u=h;var A=s*Math.sqrt(t*(1-t)/u+s*s/(4*u*u));var a=1+s*s/h;var F=(t+s*s/(2*h)-A)/a;var o=(t+s*s/(2*h)+A)/a;b[x]=[B,[t*e,(t-F)*e,(o-t)*e]]}else{b[x]=[B,[0,0,0]]}}else{var z=h?s*Math.sqrt(v*(1-v)/h):1;b[x]=[B,[e*v,e*z,e*z]]}}else{b[x]=[B,e*v]}}}else{if(this.attr_(\"customBars\")){var F=0;var C=0;var o=0;var g=0;for(var x=0;x<m.length;x++){var E=m[x][1];var l=E[1];b[x]=[m[x][0],[l,l-E[0],E[2]-l]];if(l!=null&&!isNaN(l)){F+=E[0];C+=l;o+=E[2];g+=1}if(x-d>=0){var r=m[x-d];if(r[1][1]!=null&&!isNaN(r[1][1])){F-=r[1][0];C-=r[1][1];o-=r[1][2];g-=1}}b[x]=[m[x][0],[1*C/g,1*(C-F)/g,1*(o-C)/g]]}}else{var q=Math.min(d-1,m.length-2);if(!this.attr_(\"errorBars\")){if(d==1){return m}for(var x=0;x<m.length;x++){var c=0;var D=0;for(var w=Math.max(0,x-d+1);w<x+1;w++){var l=m[w][1];if(l==null||isNaN(l)){continue}D++;c+=m[w][1]}if(D){b[x]=[m[x][0],c/D]}else{b[x]=[m[x][0],null]}}}else{for(var x=0;x<m.length;x++){var c=0;var f=0;var D=0;for(var w=Math.max(0,x-d+1);w<x+1;w++){var l=m[w][1][0];if(l==null||isNaN(l)){continue}D++;c+=m[w][1][0];f+=Math.pow(m[w][1][1],2)}if(D){var z=Math.sqrt(f)/D;b[x]=[m[x][0],[c/D,s*z,s*z]]}else{b[x]=[m[x][0],[null,null,null]]}}}}}return b};Dygraph.prototype.detectTypeFromString_=function(b){var a=false;if(b.indexOf(\"-\")>0||b.indexOf(\"/\")>=0||isNaN(parseFloat(b))){a=true}else{if(b.length==8&&b>\"19700101\"&&b<\"20371231\"){a=true}}if(a){this.attrs_.xValueFormatter=Dygraph.dateString_;this.attrs_.xValueParser=Dygraph.dateParser;this.attrs_.xTicker=Dygraph.dateTicker;this.attrs_.xAxisLabelFormatter=Dygraph.dateAxisFormatter}else{this.attrs_.xValueFormatter=function(c){return c};this.attrs_.xValueParser=function(c){return parseFloat(c)};this.attrs_.xTicker=Dygraph.numericTicks;this.attrs_.xAxisLabelFormatter=this.attrs_.xValueFormatter}};Dygraph.prototype.parseFloat_=function(a,c,b){var e=parseFloat(a);if(!isNaN(e)){return e}if(/^ *$/.test(a)){return null}if(/^ *nan *$/i.test(a)){return NaN}var d=\"Unable to parse '\"+a+\"' as a number\";if(b!==null&&c!==null){d+=\" on line \"+(1+c)+\" ('\"+b+\"') of CSV.\"}this.error(d);return null};Dygraph.prototype.parseCSV_=function(s){var r=[];var a=s.split(\"\\n\");var p=this.attr_(\"delimiter\");if(a[0].indexOf(p)==-1&&a[0].indexOf(\"\\t\")>=0){p=\"\\t\"}var b=0;if(!(\"labels\" in this.user_attrs_)){b=1;this.attrs_.labels=a[0].split(p)}var o=0;var m;var q=false;var c=this.attr_(\"labels\").length;var f=false;for(var l=b;l<a.length;l++){var e=a[l];o=l;if(e.length==0){continue}if(e[0]==\"#\"){continue}var d=e.split(p);if(d.length<2){continue}var h=[];if(!q){this.detectTypeFromString_(d[0]);m=this.attr_(\"xValueParser\");q=true}h[0]=m(d[0],this);if(this.fractions_){for(var k=1;k<d.length;k++){var g=d[k].split(\"/\");if(g.length!=2){this.error('Expected fractional \"num/den\" values in CSV data but found a value \\''+d[k]+\"' on line \"+(1+l)+\" ('\"+e+\"') which is not of this form.\");h[k]=[0,0]}else{h[k]=[this.parseFloat_(g[0],l,e),this.parseFloat_(g[1],l,e)]}}}else{if(this.attr_(\"errorBars\")){if(d.length%2!=1){this.error(\"Expected alternating (value, stdev.) pairs in CSV data but line \"+(1+l)+\" has an odd number of values (\"+(d.length-1)+\"): '\"+e+\"'\")}for(var k=1;k<d.length;k+=2){h[(k+1)/2]=[this.parseFloat_(d[k],l,e),this.parseFloat_(d[k+1],l,e)]}}else{if(this.attr_(\"customBars\")){for(var k=1;k<d.length;k++){var t=d[k];if(/^ *$/.test(t)){h[k]=[null,null,null]}else{var g=t.split(\";\");if(g.length==3){h[k]=[this.parseFloat_(g[0],l,e),this.parseFloat_(g[1],l,e),this.parseFloat_(g[2],l,e)]}else{this.warning('When using customBars, values must be either blank or \"low;center;high\" tuples (got \"'+t+'\" on line '+(1+l))}}}}else{for(var k=1;k<d.length;k++){h[k]=this.parseFloat_(d[k],l,e)}}}}if(r.length>0&&h[0]<r[r.length-1][0]){f=true}if(h.length!=c){this.error(\"Number of columns in line \"+l+\" (\"+h.length+\") does not agree with number of labels (\"+c+\") \"+e)}if(l==0&&this.attr_(\"labels\")){var n=true;for(var k=0;n&&k<h.length;k++){if(h[k]){n=false}}if(n){this.warn(\"The dygraphs 'labels' option is set, but the first row of CSV data ('\"+e+\"') appears to also contain labels. Will drop the CSV labels and use the option labels.\");continue}}r.push(h)}if(f){this.warn(\"CSV is out of order; order it correctly to speed loading.\");r.sort(function(j,i){return j[0]-i[0]})}return r};Dygraph.prototype.parseArray_=function(b){if(b.length==0){this.error(\"Can't plot empty data set\");return null}if(b[0].length==0){this.error(\"Data set cannot contain an empty row\");return null}if(this.attr_(\"labels\")==null){this.warn(\"Using default labels. Set labels explicitly via 'labels' in the options parameter\");this.attrs_.labels=[\"X\"];for(var a=1;a<b[0].length;a++){this.attrs_.labels.push(\"Y\"+a)}}if(Dygraph.isDateLike(b[0][0])){this.attrs_.xValueFormatter=Dygraph.dateString_;this.attrs_.xAxisLabelFormatter=Dygraph.dateAxisFormatter;this.attrs_.xTicker=Dygraph.dateTicker;var c=Dygraph.clone(b);for(var a=0;a<b.length;a++){if(c[a].length==0){this.error(\"Row \"+(1+a)+\" of data is empty\");return null}if(c[a][0]==null||typeof(c[a][0].getTime)!=\"function\"||isNaN(c[a][0].getTime())){this.error(\"x value in row \"+(1+a)+\" is not a Date\");return null}c[a][0]=c[a][0].getTime()}return c}else{this.attrs_.xValueFormatter=function(d){return d};this.attrs_.xTicker=Dygraph.numericTicks;return b}};Dygraph.prototype.parseDataTable_=function(v){var g=v.getNumberOfColumns();var f=v.getNumberOfRows();var e=v.getColumnType(0);if(e==\"date\"||e==\"datetime\"){this.attrs_.xValueFormatter=Dygraph.dateString_;this.attrs_.xValueParser=Dygraph.dateParser;this.attrs_.xTicker=Dygraph.dateTicker;this.attrs_.xAxisLabelFormatter=Dygraph.dateAxisFormatter}else{if(e==\"number\"){this.attrs_.xValueFormatter=function(i){return i};this.attrs_.xValueParser=function(i){return parseFloat(i)};this.attrs_.xTicker=Dygraph.numericTicks;this.attrs_.xAxisLabelFormatter=this.attrs_.xValueFormatter}else{this.error(\"only 'date', 'datetime' and 'number' types are supported for column 1 of DataTable input (Got '\"+e+\"')\");return null}}var l=[];var s={};var r=false;for(var p=1;p<g;p++){var b=v.getColumnType(p);if(b==\"number\"){l.push(p)}else{if(b==\"string\"&&this.attr_(\"displayAnnotations\")){var q=l[l.length-1];if(!s.hasOwnProperty(q)){s[q]=[p]}else{s[q].push(p)}r=true}else{this.error(\"Only 'number' is supported as a dependent type with Gviz. 'string' is only supported if displayAnnotations is true\")}}}var t=[v.getColumnLabel(0)];for(var p=0;p<l.length;p++){t.push(v.getColumnLabel(l[p]));if(this.attr_(\"errorBars\")){p+=1}}this.attrs_.labels=t;g=t.length;var u=[];var h=false;var a=[];for(var p=0;p<f;p++){var d=[];if(typeof(v.getValue(p,0))===\"undefined\"||v.getValue(p,0)===null){this.warn(\"Ignoring row \"+p+\" of DataTable because of undefined or null first column.\");continue}if(e==\"date\"||e==\"datetime\"){d.push(v.getValue(p,0).getTime())}else{d.push(v.getValue(p,0))}if(!this.attr_(\"errorBars\")){for(var n=0;n<l.length;n++){var c=l[n];d.push(v.getValue(p,c));if(r&&s.hasOwnProperty(c)&&v.getValue(p,s[c][0])!=null){var o={};o.series=v.getColumnLabel(c);o.xval=d[0];o.shortText=String.fromCharCode(65+a.length);o.text=\"\";for(var m=0;m<s[c].length;m++){if(m){o.text+=\"\\n\"}o.text+=v.getValue(p,s[c][m])}a.push(o)}}for(var n=0;n<d.length;n++){if(!isFinite(d[n])){d[n]=null}}}else{for(var n=0;n<g-1;n++){d.push([v.getValue(p,1+2*n),v.getValue(p,2+2*n)])}}if(u.length>0&&d[0]<u[u.length-1][0]){h=true}u.push(d)}if(h){this.warn(\"DataTable is out of order; order it correctly to speed loading.\");u.sort(function(j,i){return j[0]-i[0]})}this.rawData_=u;if(a.length>0){this.setAnnotations(a,true)}};Dygraph.prototype.start_=function(){if(typeof this.file_==\"function\"){this.loadedEvent_(this.file_())}else{if(Dygraph.isArrayLike(this.file_)){this.rawData_=this.parseArray_(this.file_);this.predraw_()}else{if(typeof this.file_==\"object\"&&typeof this.file_.getColumnRange==\"function\"){this.parseDataTable_(this.file_);this.predraw_()}else{if(typeof this.file_==\"string\"){if(this.file_.indexOf(\"\\n\")>=0){this.loadedEvent_(this.file_)}else{var b=new XMLHttpRequest();var a=this;b.onreadystatechange=function(){if(b.readyState==4){if(b.status==200||b.status==0){a.loadedEvent_(b.responseText)}}};b.open(\"GET\",this.file_,true);b.send(null)}}else{this.error(\"Unknown data format: \"+(typeof this.file_))}}}}};Dygraph.prototype.updateOptions=function(b,a){if(typeof(a)==\"undefined\"){a=false}if(\"rollPeriod\" in b){this.rollPeriod_=b.rollPeriod}if(\"dateWindow\" in b){this.dateWindow_=b.dateWindow;if(!(\"isZoomedIgnoreProgrammaticZoom\" in b)){this.zoomed_x_=b.dateWindow!=null}}if(\"valueRange\" in b&&!(\"isZoomedIgnoreProgrammaticZoom\" in b)){this.zoomed_y_=b.valueRange!=null}Dygraph.update(this.user_attrs_,b);if(b.file){this.file_=b.file;if(!a){this.start_()}}else{if(!a){this.predraw_()}}};Dygraph.prototype.resize=function(b,a){if(this.resize_lock){return}this.resize_lock=true;if((b===null)!=(a===null)){this.warn(\"Dygraph.resize() should be called with zero parameters or two non-NULL parameters. Pretending it was zero.\");b=a=null}this.maindiv_.innerHTML=\"\";this.attrs_.labelsDiv=null;if(b){this.maindiv_.style.width=b+\"px\";this.maindiv_.style.height=a+\"px\";this.width_=b;this.height_=a}else{this.width_=this.maindiv_.offsetWidth;this.height_=this.maindiv_.offsetHeight}this.createInterface_();this.predraw_();this.resize_lock=false};Dygraph.prototype.adjustRoll=function(a){this.rollPeriod_=a;this.predraw_()};Dygraph.prototype.visibility=function(){if(!this.attr_(\"visibility\")){this.attrs_.visibility=[]}while(this.attr_(\"visibility\").length<this.rawData_[0].length-1){this.attr_(\"visibility\").push(true)}return this.attr_(\"visibility\")};Dygraph.prototype.setVisibility=function(b,c){var a=this.visibility();if(b<0||b>=a.length){this.warn(\"invalid series number in setVisibility: \"+b)}else{a[b]=c;this.predraw_()}};Dygraph.prototype.setAnnotations=function(b,a){Dygraph.addAnnotationRule();this.annotations_=b;this.layout_.setAnnotations(this.annotations_);if(!a){this.predraw_()}};Dygraph.prototype.annotations=function(){return this.annotations_};Dygraph.prototype.indexFromSetName=function(a){var c=this.attr_(\"labels\");for(var b=0;b<c.length;b++){if(c[b]==a){return b}}return null};Dygraph.addAnnotationRule=function(){if(Dygraph.addedAnnotationCSS){return}var f=\"border: 1px solid black; background-color: white; text-align: center;\";var e=document.createElement(\"style\");e.type=\"text/css\";document.getElementsByTagName(\"head\")[0].appendChild(e);for(var b=0;b<document.styleSheets.length;b++){if(document.styleSheets[b].disabled){continue}var d=document.styleSheets[b];try{if(d.insertRule){var a=d.cssRules?d.cssRules.length:0;d.insertRule(\".dygraphDefaultAnnotation { \"+f+\" }\",a)}else{if(d.addRule){d.addRule(\".dygraphDefaultAnnotation\",f)}}Dygraph.addedAnnotationCSS=true;return}catch(c){}}this.warn(\"Unable to add default annotation CSS rule; display may be off.\")};DateGraph=Dygraph;Dygraph.LOG_SCALE=10;Dygraph.LN_TEN=Math.log(Dygraph.LOG_SCALE);Dygraph.log10=function(a){return Math.log(a)/Dygraph.LN_TEN};Dygraph.DEBUG=1;Dygraph.INFO=2;Dygraph.WARNING=3;Dygraph.ERROR=3;Dygraph.log=function(a,b){if(typeof(console)!=\"undefined\"){switch(a){case Dygraph.DEBUG:console.debug(\"dygraphs: \"+b);break;case Dygraph.INFO:console.info(\"dygraphs: \"+b);break;case Dygraph.WARNING:console.warn(\"dygraphs: \"+b);break;case Dygraph.ERROR:console.error(\"dygraphs: \"+b);break}}};Dygraph.info=function(a){Dygraph.log(Dygraph.INFO,a)};Dygraph.prototype.info=Dygraph.info;Dygraph.warn=function(a){Dygraph.log(Dygraph.WARNING,a)};Dygraph.prototype.warn=Dygraph.warn;Dygraph.error=function(a){Dygraph.log(Dygraph.ERROR,a)};Dygraph.prototype.error=Dygraph.error;Dygraph.getContext=function(a){return a.getContext(\"2d\")};Dygraph.addEvent=function(c,a,b){var d=function(f){if(!f){var f=window.event}b(f)};if(window.addEventListener){c.addEventListener(a,d,false)}else{c.attachEvent(\"on\"+a,d)}};Dygraph.cancelEvent=function(a){a=a?a:window.event;if(a.stopPropagation){a.stopPropagation()}if(a.preventDefault){a.preventDefault()}a.cancelBubble=true;a.cancel=true;a.returnValue=false;return false};Dygraph.hsvToRGB=function(h,g,k){var c;var d;var l;if(g===0){c=k;d=k;l=k}else{var e=Math.floor(h*6);var j=(h*6)-e;var b=k*(1-g);var a=k*(1-(g*j));var m=k*(1-(g*(1-j)));switch(e){case 1:c=a;d=k;l=b;break;case 2:c=b;d=k;l=m;break;case 3:c=b;d=a;l=k;break;case 4:c=m;d=b;l=k;break;case 5:c=k;d=b;l=a;break;case 6:case 0:c=k;d=m;l=b;break}}c=Math.floor(255*c+0.5);d=Math.floor(255*d+0.5);l=Math.floor(255*l+0.5);return\"rgb(\"+c+\",\"+d+\",\"+l+\")\"};Dygraph.findPosX=function(b){var c=0;if(b.offsetParent){var a=b;while(1){c+=a.offsetLeft;if(!a.offsetParent){break}a=a.offsetParent}}else{if(b.x){c+=b.x}}while(b&&b!=document.body){c-=b.scrollLeft;b=b.parentNode}return c};Dygraph.findPosY=function(c){var b=0;if(c.offsetParent){var a=c;while(1){b+=a.offsetTop;if(!a.offsetParent){break}a=a.offsetParent}}else{if(c.y){b+=c.y}}while(c&&c!=document.body){b-=c.scrollTop;c=c.parentNode}return b};Dygraph.pageX=function(c){if(c.pageX){return(!c.pageX||c.pageX<0)?0:c.pageX}else{var d=document;var a=document.body;return c.clientX+(d.scrollLeft||a.scrollLeft)-(d.clientLeft||0)}};Dygraph.pageY=function(c){if(c.pageY){return(!c.pageY||c.pageY<0)?0:c.pageY}else{var d=document;var a=document.body;return c.clientY+(d.scrollTop||a.scrollTop)-(d.clientTop||0)}};Dygraph.isOK=function(a){return a&&!isNaN(a)};Dygraph.floatFormat=function(a,b){var c=Math.min(Math.max(1,b||2),21);return(Math.abs(a)<0.001&&a!=0)?a.toExponential(c-1):a.toPrecision(c)};Dygraph.zeropad=function(a){if(a<10){return\"0\"+a}else{return\"\"+a}};Dygraph.hmsString_=function(a){var c=Dygraph.zeropad;var b=new Date(a);if(b.getSeconds()){return c(b.getHours())+\":\"+c(b.getMinutes())+\":\"+c(b.getSeconds())}else{return c(b.getHours())+\":\"+c(b.getMinutes())}};Dygraph.dateString_=function(e){var i=Dygraph.zeropad;var h=new Date(e);var f=\"\"+h.getFullYear();var g=i(h.getMonth()+1);var a=i(h.getDate());var c=\"\";var b=h.getHours()*3600+h.getMinutes()*60+h.getSeconds();if(b){c=\" \"+Dygraph.hmsString_(e)}return f+\"/\"+g+\"/\"+a+c};Dygraph.round_=function(c,b){var a=Math.pow(10,b);return Math.round(c*a)/a};Dygraph.binarySearch=function(a,d,i,e,b){if(e==null||b==null){e=0;b=d.length-1}if(e>b){return -1}if(i==null){i=0}var h=function(j){return j>=0&&j<d.length};var g=parseInt((e+b)/2);var c=d[g];if(c==a){return g}if(c>a){if(i>0){var f=g-1;if(h(f)&&d[f]<a){return g}}return Dygraph.binarySearch(a,d,i,e,g-1)}if(c<a){if(i<0){var f=g+1;if(h(f)&&d[f]>a){return g}}return Dygraph.binarySearch(a,d,i,g+1,b)}};Dygraph.dateParser=function(a){var b;var c;if(a.search(\"-\")!=-1){b=a.replace(\"-\",\"/\",\"g\");while(b.search(\"-\")!=-1){b=b.replace(\"-\",\"/\")}c=Dygraph.dateStrToMillis(b)}else{if(a.length==8){b=a.substr(0,4)+\"/\"+a.substr(4,2)+\"/\"+a.substr(6,2);c=Dygraph.dateStrToMillis(b)}else{c=Dygraph.dateStrToMillis(a)}}if(!c||isNaN(c)){Dygraph.error(\"Couldn't parse \"+a+\" as a date\")}return c};Dygraph.dateStrToMillis=function(a){return new Date(a).getTime()};Dygraph.update=function(b,c){if(typeof(c)!=\"undefined\"&&c!==null){for(var a in c){if(c.hasOwnProperty(a)){b[a]=c[a]}}}return b};Dygraph.isArrayLike=function(b){var a=typeof(b);if((a!=\"object\"&&!(a==\"function\"&&typeof(b.item)==\"function\"))||b===null||typeof(b.length)!=\"number\"||b.nodeType===3){return false}return true};Dygraph.isDateLike=function(a){if(typeof(a)!=\"object\"||a===null||typeof(a.getTime)!=\"function\"){return false}return true};Dygraph.clone=function(c){var b=[];for(var a=0;a<c.length;a++){if(Dygraph.isArrayLike(c[a])){b.push(Dygraph.clone(c[a]))}else{b.push(c[a])}}return b};Dygraph.createCanvas=function(){var a=document.createElement(\"canvas\");isIE=(/MSIE/.test(navigator.userAgent)&&!window.opera);if(isIE&&(typeof(G_vmlCanvasManager)!=\"undefined\")){a=G_vmlCanvasManager.initElement(a)}return a};Dygraph.GVizChart=function(a){this.container=a};Dygraph.GVizChart.prototype.draw=function(b,a){this.container.innerHTML=\"\";if(typeof(this.date_graph)!=\"undefined\"){this.date_graph.destroy()}this.date_graph=new Dygraph(this.container,b,a)};Dygraph.GVizChart.prototype.setSelection=function(b){var a=false;if(b.length){a=b[0].row}this.date_graph.setSelection(a)};Dygraph.GVizChart.prototype.getSelection=function(){var b=[];var c=this.date_graph.getSelection();if(c<0){return b}col=1;for(var a in this.date_graph.layout_.datasets){b.push({row:c,column:col});col++}return b};Dygraph.Interaction={};Dygraph.Interaction.startPan=function(n,s,c){c.isPanning=true;var j=s.xAxisRange();c.dateRange=j[1]-j[0];c.initialLeftmostDate=j[0];c.xUnitsPerPixel=c.dateRange/(s.plotter_.area.w-1);if(s.attr_(\"panEdgeFraction\")){var v=s.width_*s.attr_(\"panEdgeFraction\");var d=s.xAxisExtremes();var h=s.toDomXCoord(d[0])-v;var k=s.toDomXCoord(d[1])+v;var t=s.toDataXCoord(h);var u=s.toDataXCoord(k);c.boundedDates=[t,u];var f=[];var a=s.height_*s.attr_(\"panEdgeFraction\");for(var q=0;q<s.axes_.length;q++){var b=s.axes_[q];var o=b.extremeRange;var p=s.toDomYCoord(o[0],q)+a;var r=s.toDomYCoord(o[1],q)-a;var m=s.toDataYCoord(p);var e=s.toDataYCoord(r);f[q]=[m,e]}c.boundedValues=f}c.is2DPan=false;for(var q=0;q<s.axes_.length;q++){var b=s.axes_[q];var l=s.yAxisRange(q);if(b.logscale){b.initialTopValue=Dygraph.log10(l[1]);b.dragValueRange=Dygraph.log10(l[1])-Dygraph.log10(l[0])}else{b.initialTopValue=l[1];b.dragValueRange=l[1]-l[0]}b.unitsPerPixel=b.dragValueRange/(s.plotter_.area.h-1);if(b.valueWindow||b.valueRange){c.is2DPan=true}}};Dygraph.Interaction.movePan=function(b,k,c){c.dragEndX=k.dragGetX_(b,c);c.dragEndY=k.dragGetY_(b,c);var h=c.initialLeftmostDate-(c.dragEndX-c.dragStartX)*c.xUnitsPerPixel;if(c.boundedDates){h=Math.max(h,c.boundedDates[0])}var a=h+c.dateRange;if(c.boundedDates){if(a>c.boundedDates[1]){h=h-(a-c.boundedDates[1]);a=h+c.dateRange}}k.dateWindow_=[h,a];if(c.is2DPan){for(var j=0;j<k.axes_.length;j++){var e=k.axes_[j];var d=c.dragEndY-c.dragStartY;var n=d*e.unitsPerPixel;var f=c.boundedValues?c.boundedValues[j]:null;var l=e.initialTopValue+n;if(f){l=Math.min(l,f[1])}var m=l-e.dragValueRange;if(f){if(m<f[0]){l=l-(m-f[0]);m=l-e.dragValueRange}}if(e.logscale){e.valueWindow=[Math.pow(Dygraph.LOG_SCALE,m),Math.pow(Dygraph.LOG_SCALE,l)]}else{e.valueWindow=[m,l]}}}k.drawGraph_(false)};Dygraph.Interaction.endPan=function(c,b,a){a.dragEndX=b.dragGetX_(c,a);a.dragEndY=b.dragGetY_(c,a);var e=Math.abs(a.dragEndX-a.dragStartX);var d=Math.abs(a.dragEndY-a.dragStartY);if(e<2&&d<2&&b.lastx_!=undefined&&b.lastx_!=-1){Dygraph.Interaction.treatMouseOpAsClick(b,c,a)}a.isPanning=false;a.is2DPan=false;a.initialLeftmostDate=null;a.dateRange=null;a.valueRange=null;a.boundedDates=null;a.boundedValues=null};Dygraph.Interaction.startZoom=function(c,b,a){a.isZooming=true};Dygraph.Interaction.moveZoom=function(c,b,a){a.dragEndX=b.dragGetX_(c,a);a.dragEndY=b.dragGetY_(c,a);var e=Math.abs(a.dragStartX-a.dragEndX);var d=Math.abs(a.dragStartY-a.dragEndY);a.dragDirection=(e<d/2)?Dygraph.VERTICAL:Dygraph.HORIZONTAL;b.drawZoomRect_(a.dragDirection,a.dragStartX,a.dragEndX,a.dragStartY,a.dragEndY,a.prevDragDirection,a.prevEndX,a.prevEndY);a.prevEndX=a.dragEndX;a.prevEndY=a.dragEndY;a.prevDragDirection=a.dragDirection};Dygraph.Interaction.treatMouseOpAsClick=function(f,b,d){var k=f.attr_(\"clickCallback\");var n=f.attr_(\"pointClickCallback\");var j=null;if(n){var l=-1;var m=Number.MAX_VALUE;for(var e=0;e<f.selPoints_.length;e++){var c=f.selPoints_[e];var a=Math.pow(c.canvasx-d.dragEndX,2)+Math.pow(c.canvasy-d.dragEndY,2);if(l==-1||a<m){m=a;l=e}}var h=f.attr_(\"highlightCircleSize\")+2;if(m<=h*h){j=f.selPoints_[l]}}if(j){n(b,j)}if(k){k(b,f.lastx_,f.selPoints_)}};Dygraph.Interaction.endZoom=function(c,b,a){a.isZooming=false;a.dragEndX=b.dragGetX_(c,a);a.dragEndY=b.dragGetY_(c,a);var e=Math.abs(a.dragEndX-a.dragStartX);var d=Math.abs(a.dragEndY-a.dragStartY);if(e<2&&d<2&&b.lastx_!=undefined&&b.lastx_!=-1){Dygraph.Interaction.treatMouseOpAsClick(b,c,a)}if(e>=10&&a.dragDirection==Dygraph.HORIZONTAL){b.doZoomX_(Math.min(a.dragStartX,a.dragEndX),Math.max(a.dragStartX,a.dragEndX))}else{if(d>=10&&a.dragDirection==Dygraph.VERTICAL){b.doZoomY_(Math.min(a.dragStartY,a.dragEndY),Math.max(a.dragStartY,a.dragEndY))}else{b.canvas_ctx_.clearRect(0,0,b.canvas_.width,b.canvas_.height)}}a.dragStartX=null;a.dragStartY=null};Dygraph.Interaction.defaultModel={mousedown:function(c,b,a){a.initializeMouseDown(c,b,a);if(c.altKey||c.shiftKey){Dygraph.startPan(c,b,a)}else{Dygraph.startZoom(c,b,a)}},mousemove:function(c,b,a){if(a.isZooming){Dygraph.moveZoom(c,b,a)}else{if(a.isPanning){Dygraph.movePan(c,b,a)}}},mouseup:function(c,b,a){if(a.isZooming){Dygraph.endZoom(c,b,a)}else{if(a.isPanning){Dygraph.endPan(c,b,a)}}},mouseout:function(c,b,a){if(a.isZooming){a.dragEndX=null;a.dragEndY=null}},dblclick:function(c,b,a){if(c.altKey||c.shiftKey){return}b.doUnzoom_()}};Dygraph.DEFAULT_ATTRS.interactionModel=Dygraph.Interaction.defaultModel;Dygraph.defaultInteractionModel=Dygraph.Interaction.defaultModel;Dygraph.endZoom=Dygraph.Interaction.endZoom;Dygraph.moveZoom=Dygraph.Interaction.moveZoom;Dygraph.startZoom=Dygraph.Interaction.startZoom;Dygraph.endPan=Dygraph.Interaction.endPan;Dygraph.movePan=Dygraph.Interaction.movePan;Dygraph.startPan=Dygraph.Interaction.startPan;function RGBColor(g){this.ok=false;if(g.charAt(0)==\"#\"){g=g.substr(1,6)}g=g.replace(/ /g,\"\");g=g.toLowerCase();var a={aliceblue:\"f0f8ff\",antiquewhite:\"faebd7\",aqua:\"00ffff\",aquamarine:\"7fffd4\",azure:\"f0ffff\",beige:\"f5f5dc\",bisque:\"ffe4c4\",black:\"000000\",blanchedalmond:\"ffebcd\",blue:\"0000ff\",blueviolet:\"8a2be2\",brown:\"a52a2a\",burlywood:\"deb887\",cadetblue:\"5f9ea0\",chartreuse:\"7fff00\",chocolate:\"d2691e\",coral:\"ff7f50\",cornflowerblue:\"6495ed\",cornsilk:\"fff8dc\",crimson:\"dc143c\",cyan:\"00ffff\",darkblue:\"00008b\",darkcyan:\"008b8b\",darkgoldenrod:\"b8860b\",darkgray:\"a9a9a9\",darkgreen:\"006400\",darkkhaki:\"bdb76b\",darkmagenta:\"8b008b\",darkolivegreen:\"556b2f\",darkorange:\"ff8c00\",darkorchid:\"9932cc\",darkred:\"8b0000\",darksalmon:\"e9967a\",darkseagreen:\"8fbc8f\",darkslateblue:\"483d8b\",darkslategray:\"2f4f4f\",darkturquoise:\"00ced1\",darkviolet:\"9400d3\",deeppink:\"ff1493\",deepskyblue:\"00bfff\",dimgray:\"696969\",dodgerblue:\"1e90ff\",feldspar:\"d19275\",firebrick:\"b22222\",floralwhite:\"fffaf0\",forestgreen:\"228b22\",fuchsia:\"ff00ff\",gainsboro:\"dcdcdc\",ghostwhite:\"f8f8ff\",gold:\"ffd700\",goldenrod:\"daa520\",gray:\"808080\",green:\"008000\",greenyellow:\"adff2f\",honeydew:\"f0fff0\",hotpink:\"ff69b4\",indianred:\"cd5c5c\",indigo:\"4b0082\",ivory:\"fffff0\",khaki:\"f0e68c\",lavender:\"e6e6fa\",lavenderblush:\"fff0f5\",lawngreen:\"7cfc00\",lemonchiffon:\"fffacd\",lightblue:\"add8e6\",lightcoral:\"f08080\",lightcyan:\"e0ffff\",lightgoldenrodyellow:\"fafad2\",lightgrey:\"d3d3d3\",lightgreen:\"90ee90\",lightpink:\"ffb6c1\",lightsalmon:\"ffa07a\",lightseagreen:\"20b2aa\",lightskyblue:\"87cefa\",lightslateblue:\"8470ff\",lightslategray:\"778899\",lightsteelblue:\"b0c4de\",lightyellow:\"ffffe0\",lime:\"00ff00\",limegreen:\"32cd32\",linen:\"faf0e6\",magenta:\"ff00ff\",maroon:\"800000\",mediumaquamarine:\"66cdaa\",mediumblue:\"0000cd\",mediumorchid:\"ba55d3\",mediumpurple:\"9370d8\",mediumseagreen:\"3cb371\",mediumslateblue:\"7b68ee\",mediumspringgreen:\"00fa9a\",mediumturquoise:\"48d1cc\",mediumvioletred:\"c71585\",midnightblue:\"191970\",mintcream:\"f5fffa\",mistyrose:\"ffe4e1\",moccasin:\"ffe4b5\",navajowhite:\"ffdead\",navy:\"000080\",oldlace:\"fdf5e6\",olive:\"808000\",olivedrab:\"6b8e23\",orange:\"ffa500\",orangered:\"ff4500\",orchid:\"da70d6\",palegoldenrod:\"eee8aa\",palegreen:\"98fb98\",paleturquoise:\"afeeee\",palevioletred:\"d87093\",papayawhip:\"ffefd5\",peachpuff:\"ffdab9\",peru:\"cd853f\",pink:\"ffc0cb\",plum:\"dda0dd\",powderblue:\"b0e0e6\",purple:\"800080\",red:\"ff0000\",rosybrown:\"bc8f8f\",royalblue:\"4169e1\",saddlebrown:\"8b4513\",salmon:\"fa8072\",sandybrown:\"f4a460\",seagreen:\"2e8b57\",seashell:\"fff5ee\",sienna:\"a0522d\",silver:\"c0c0c0\",skyblue:\"87ceeb\",slateblue:\"6a5acd\",slategray:\"708090\",snow:\"fffafa\",springgreen:\"00ff7f\",steelblue:\"4682b4\",tan:\"d2b48c\",teal:\"008080\",thistle:\"d8bfd8\",tomato:\"ff6347\",turquoise:\"40e0d0\",violet:\"ee82ee\",violetred:\"d02090\",wheat:\"f5deb3\",white:\"ffffff\",whitesmoke:\"f5f5f5\",yellow:\"ffff00\",yellowgreen:\"9acd32\"};for(var c in a){if(g==c){g=a[c]}}var h=[{re:/^rgb\\((\\d{1,3}),\\s*(\\d{1,3}),\\s*(\\d{1,3})\\)$/,example:[\"rgb(123, 234, 45)\",\"rgb(255,234,245)\"],process:function(i){return[parseInt(i[1]),parseInt(i[2]),parseInt(i[3])]}},{re:/^(\\w{2})(\\w{2})(\\w{2})$/,example:[\"#00ff00\",\"336699\"],process:function(i){return[parseInt(i[1],16),parseInt(i[2],16),parseInt(i[3],16)]}},{re:/^(\\w{1})(\\w{1})(\\w{1})$/,example:[\"#fb0\",\"f0f\"],process:function(i){return[parseInt(i[1]+i[1],16),parseInt(i[2]+i[2],16),parseInt(i[3]+i[3],16)]}}];for(var b=0;b<h.length;b++){var e=h[b].re;var d=h[b].process;var f=e.exec(g);if(f){channels=d(f);this.r=channels[0];this.g=channels[1];this.b=channels[2];this.ok=true}}this.r=(this.r<0||isNaN(this.r))?0:((this.r>255)?255:this.r);this.g=(this.g<0||isNaN(this.g))?0:((this.g>255)?255:this.g);this.b=(this.b<0||isNaN(this.b))?0:((this.b>255)?255:this.b);this.toRGB=function(){return\"rgb(\"+this.r+\", \"+this.g+\", \"+this.b+\")\"};this.toHex=function(){var k=this.r.toString(16);var j=this.g.toString(16);var i=this.b.toString(16);if(k.length==1){k=\"0\"+k}if(j.length==1){j=\"0\"+j}if(i.length==1){i=\"0\"+i}return\"#\"+k+j+i}}Date.ext={};Date.ext.util={};Date.ext.util.xPad=function(a,c,b){if(typeof(b)==\"undefined\"){b=10}for(;parseInt(a,10)<b&&b>1;b/=10){a=c.toString()+a}return a.toString()};Date.prototype.locale=\"en-GB\";if(document.getElementsByTagName(\"html\")&&document.getElementsByTagName(\"html\")[0].lang){Date.prototype.locale=document.getElementsByTagName(\"html\")[0].lang}Date.ext.locales={};Date.ext.locales.en={a:[\"Sun\",\"Mon\",\"Tue\",\"Wed\",\"Thu\",\"Fri\",\"Sat\"],A:[\"Sunday\",\"Monday\",\"Tuesday\",\"Wednesday\",\"Thursday\",\"Friday\",\"Saturday\"],b:[\"Jan\",\"Feb\",\"Mar\",\"Apr\",\"May\",\"Jun\",\"Jul\",\"Aug\",\"Sep\",\"Oct\",\"Nov\",\"Dec\"],B:[\"January\",\"February\",\"March\",\"April\",\"May\",\"June\",\"July\",\"August\",\"September\",\"October\",\"November\",\"December\"],c:\"%a %d %b %Y %T %Z\",p:[\"AM\",\"PM\"],P:[\"am\",\"pm\"],x:\"%d/%m/%y\",X:\"%T\"};Date.ext.locales[\"en-US\"]=Date.ext.locales.en;Date.ext.locales[\"en-US\"].c=\"%a %d %b %Y %r %Z\";Date.ext.locales[\"en-US\"].x=\"%D\";Date.ext.locales[\"en-US\"].X=\"%r\";Date.ext.locales[\"en-GB\"]=Date.ext.locales.en;Date.ext.locales[\"en-AU\"]=Date.ext.locales[\"en-GB\"];Date.ext.formats={a:function(a){return Date.ext.locales[a.locale].a[a.getDay()]},A:function(a){return Date.ext.locales[a.locale].A[a.getDay()]},b:function(a){return Date.ext.locales[a.locale].b[a.getMonth()]},B:function(a){return Date.ext.locales[a.locale].B[a.getMonth()]},c:\"toLocaleString\",C:function(a){return Date.ext.util.xPad(parseInt(a.getFullYear()/100,10),0)},d:[\"getDate\",\"0\"],e:[\"getDate\",\" \"],g:function(a){return Date.ext.util.xPad(parseInt(Date.ext.util.G(a)/100,10),0)},G:function(c){var e=c.getFullYear();var b=parseInt(Date.ext.formats.V(c),10);var a=parseInt(Date.ext.formats.W(c),10);if(a>b){e++}else{if(a===0&&b>=52){e--}}return e},H:[\"getHours\",\"0\"],I:function(b){var a=b.getHours()%12;return Date.ext.util.xPad(a===0?12:a,0)},j:function(c){var a=c-new Date(\"\"+c.getFullYear()+\"/1/1 GMT\");a+=c.getTimezoneOffset()*60000;var b=parseInt(a/60000/60/24,10)+1;return Date.ext.util.xPad(b,0,100)},m:function(a){return Date.ext.util.xPad(a.getMonth()+1,0)},M:[\"getMinutes\",\"0\"],p:function(a){return Date.ext.locales[a.locale].p[a.getHours()>=12?1:0]},P:function(a){return Date.ext.locales[a.locale].P[a.getHours()>=12?1:0]},S:[\"getSeconds\",\"0\"],u:function(a){var b=a.getDay();return b===0?7:b},U:function(e){var a=parseInt(Date.ext.formats.j(e),10);var c=6-e.getDay();var b=parseInt((a+c)/7,10);return Date.ext.util.xPad(b,0)},V:function(e){var c=parseInt(Date.ext.formats.W(e),10);var a=(new Date(\"\"+e.getFullYear()+\"/1/1\")).getDay();var b=c+(a>4||a<=1?0:1);if(b==53&&(new Date(\"\"+e.getFullYear()+\"/12/31\")).getDay()<4){b=1}else{if(b===0){b=Date.ext.formats.V(new Date(\"\"+(e.getFullYear()-1)+\"/12/31\"))}}return Date.ext.util.xPad(b,0)},w:\"getDay\",W:function(e){var a=parseInt(Date.ext.formats.j(e),10);var c=7-Date.ext.formats.u(e);var b=parseInt((a+c)/7,10);return Date.ext.util.xPad(b,0,10)},y:function(a){return Date.ext.util.xPad(a.getFullYear()%100,0)},Y:\"getFullYear\",z:function(c){var b=c.getTimezoneOffset();var a=Date.ext.util.xPad(parseInt(Math.abs(b/60),10),0);var e=Date.ext.util.xPad(b%60,0);return(b>0?\"-\":\"+\")+a+e},Z:function(a){return a.toString().replace(/^.*\\(([^)]+)\\)$/,\"$1\")},\"%\":function(a){return\"%\"}};Date.ext.aggregates={c:\"locale\",D:\"%m/%d/%y\",h:\"%b\",n:\"\\n\",r:\"%I:%M:%S %p\",R:\"%H:%M\",t:\"\\t\",T:\"%H:%M:%S\",x:\"locale\",X:\"locale\"};Date.ext.aggregates.z=Date.ext.formats.z(new Date());Date.ext.aggregates.Z=Date.ext.formats.Z(new Date());Date.ext.unsupported={};Date.prototype.strftime=function(a){if(!(this.locale in Date.ext.locales)){if(this.locale.replace(/-[a-zA-Z]+$/,\"\") in Date.ext.locales){this.locale=this.locale.replace(/-[a-zA-Z]+$/,\"\")}else{this.locale=\"en-GB\"}}var c=this;while(a.match(/%[cDhnrRtTxXzZ]/)){a=a.replace(/%([cDhnrRtTxXzZ])/g,function(e,d){var g=Date.ext.aggregates[d];return(g==\"locale\"?Date.ext.locales[c.locale][d]:g)})}var b=a.replace(/%([aAbBCdegGHIjmMpPSuUVwWyY%])/g,function(e,d){var g=Date.ext.formats[d];if(typeof(g)==\"string\"){return c[g]()}else{if(typeof(g)==\"function\"){return g.call(c,c)}else{if(typeof(g)==\"object\"&&typeof(g[0])==\"string\"){return Date.ext.util.xPad(c[g[0]](),g[1])}else{return d}}}});c=null;return b};";
var REPORT_SUMMARY_TEMPLATE= exports.REPORT_SUMMARY_TEMPLATE="<html>\n    <head>\n        <title>Test Results</title>\n        <script language=\"javascript\" type=\"text/javascript\"><!--\n            <%=DYGRAPH_SOURCE%>\n            function jsonToTable(json) {\n                var txt = \"\";\n                for (var i in json)\n                    txt += \"<tr><td class=label>\" + i + \"</td><td>\" + json[i] + \"</td></tr>\";\n                return \"<table>\" + txt + \"</table>\";\n            };\n        --></script>\n        <style><!--\n            body { margin: 0px; font: 13px Arial, Helvetica, sans-serif; }\n            h1 { font-size: 2.4em; }\n            p, ol, ul { line-height: 30%; }\n            a:hover { text-decoration: none; }\n            #main { float:left; width: 740px; }\n            #sidebar { float:right; width: 260px; height: 100%; border-left: #BFC9AE solid 1px; margin-left: 10px; padding-left: 10px;}\n            #header { width: 100%; height: 120px; margin: 0px auto; color: #FFFFFF; background: #699C4D; border: 3px solid darkgreen; border-style: none none solid none;}\n            #header h1 { width: 1024; padding: 25px 0px 0px 0px; margin: 0px auto; font-weight: normal; }\n            #header p { width: 1024; padding: 15px 0px 0px 0px; margin: 0px auto; }\n            #chkPause { float: right; margin-right: 10px; }\n            #page { width: 1024px; margin: 0px auto; padding: 30px 0px; }\n            .post { margin: 0px 0px 30px 0px; }\n            .post h1, .post h2 { margin: 0px; padding: 0px 0px 5px 0px; border-bottom: #BFC9AE solid 1px; color: #232F01; }\n            .entry { margin: 10px 0px 20px 0px; }\n            #footer { clear: both; width: 1024px; height: 50px; margin: 0px auto 30px auto; color: #FFFFFF; background: #699C4D; }\n            #footer p { padding: 19px 0px 0px 0px; text-align: center; line-height: normal; font-size: smaller; }\n            #footer a { color: #FFFFFF; }\n            .statsTable table { font-size: small; font-variant: small-caps; border-spacing: 10px 1px; }\n            .statsTable .label { text-align:right; }\n        --></style>\n    </head>\n\n    <body>\n        <div id=\"header\">\n            <h1>Test Results</h1>\n            <p id=\"timestamp\"><%=new Date()%></p>\n            <p><input type=\"checkbox\" id=\"chkAutoRefresh\" checked=\"true\"><label for=\"chkAutoRefresh\">Auto-refresh</label></input><p>\n        </div>\n        <div id=\"page\">\n            <div id=\"main\"></div>\n            <div id=\"sidebar\">\n                <div class=\"post\">\n                    <h2>Cumulative</h2>\n                    <div id=\"summaries\" class=\"entry\"></div>\n                </div>\n            </div>\n        </div>\n        <div id=\"footer\"><p>generated with <a href=\"http://github.com/benschmaus/nodeload\">nodeload</a></p></div>\n    </body>\n\n    <script id=\"source\" language=\"javascript\" type=\"text/javascript\">\n        var raw_reports;\n        function updateDate(date) {\n            document.getElementById(\"timestamp\").innerHTML = date || new Date();\n        }\n        function update(reports) {\n            var main = document.getElementById(\"main\"), summaries = document.getElementById(\"summaries\");\n            raw_reports = reports;\n            reports.forEach(function(report) {\n                \n                var summary = document.getElementById(\"reportSummary\" + report.uid);\n                if (!summary) {\n                    var summary = document.createElement(\"p\");\n                    summary.setAttribute(\"id\", \"reportSummary\" + report.uid);\n                    summary.setAttribute(\"class\", \"statsTable\");\n                    summaries.appendChild(summary);\n                }\n                summary.innerHTML = jsonToTable(report.summary);\n                \n                for (var j in report.charts) {\n                    var chart = report.charts[j];\n                    var rows = chart.rows.map(function(x) { return [new Date(x[0])].concat(x.slice(1)) });\n                    if (graphs[chart.uid]) {\n                        graphs[chart.uid].updateOptions({\"file\": rows, labels: chart.columns});\n                    } else {\n                        var newchart = document.createElement(\"div\");\n                        newchart.setAttribute(\"class\", \"post\");\n                        newchart.innerHTML = [].concat(\n                            '<h2>', report.name, ': ', chart.name, '</h2>',\n                            '<div class=\"entry\" style=\"width:100%;float:left\">',\n                                '<div id=\"chart', chart.uid, '\" style=\"float:left;width:660px;height:200px;\"></div>',\n                                '<div id=\"chartlegend', chart.uid, '\" style=\"float:left;width:80px;height:200px;\"></div>',\n                            '</div>'\n                        ).join('');\n                        main.appendChild(newchart);\n                        graphs[chart.uid] = new Dygraph(\n                            document.getElementById(\"chart\" + chart.uid),\n                            rows,\n                            {\n                                labelsDiv: document.getElementById(\"chartlegend\" + chart.uid),\n                                labelsSeparateLines: true,\n                                labels: chart.columns,\n                                xAxisLabelWidth: 80\n                            });\n                    }\n                }\n            });\n        }\n\n        if(navigator.appName == \"Microsoft Internet Explorer\") { http = new ActiveXObject(\"Microsoft.XMLHTTP\"); } else { http = new XMLHttpRequest(); }\n\n        setInterval(function() {\n            if (document.getElementById(\"chkAutoRefresh\").checked) {\n                http.open(\"GET\", \"/reports\");\n                http.onreadystatechange=function() { \n                    if (http.readyState == 4 && http.status == 200) {\n                        updateDate();\n                        update(JSON.parse(http.responseText));\n                    }\n                }\n                http.send(null);\n            }\n        }, <%=refreshPeriodMs%>);\n        \n        graphs = {};\n        update(<%=JSON.stringify(reports)%>);\n    </script>\n</html>";
/*
 * Based off of:
 * - Chad Etzel - http://github.com/jazzychad/template.node.js/
 * - John Resig - http://ejohn.org/blog/javascript-micro-templating/
 */
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var fs = require('fs');
}

var template = {
    cache_: {},
    create: function(str, data, callback) {
        // Figure out if we're getting a template, or if we need to
        // load the template - and be sure to cache the result.
        var fn;

        if (!/[\t\r\n% ]/.test(str)) {
            if (!callback) {
                fn = this.create(fs.readFileSync(str).toString('utf8'));
            } else {
                fs.readFile(str, function(err, buffer) {
                    if (err) { throw err; }

                    this.create(buffer.toString('utf8'), data, callback);
                });
                return;
            }    
        } else {
            if (this.cache_[str]) {
                fn = this.cache_[str];
            } else {
                // Generate a reusable function that will serve as a template
                // generator (and which will be cached).
                fn = new Function("obj",
                    "var p=[],print=function(){p.push.apply(p,arguments);};" +
                    "obj=obj||{};" +
                    // Introduce the data as local variables using with(){}
                    "with(obj){p.push('" +

                    // Convert the template into pure JavaScript
                    str.split("'").join("\\'")
                        .split("\n").join("\\n")
                        .replace(/<%([\s\S]*?)%>/mg, function(m, t) { return '<%' + t.split("\\'").join("'").split("\\n").join("\n") + '%>'; })
                        .replace(/<%=(.+?)%>/g, "',$1,'")
                        .split("<%").join("');")
                        .split("%>").join("p.push('") + "');}return p.join('');");

                this.cache_[str] = fn;
            }
        }

        // Provide some "basic" currying to the user
        if (callback) { callback(data ? fn( data ) : fn); }
        else { return data ? fn( data ) : fn; }
    }
};

exports.create = template.create.bind(template);// This file defines Report, Chart, and ReportGroup
//
// A Report contains a summary and a number of charts.
//
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var querystring = require('querystring');
var LogFile = require('../stats').LogFile;
var template = require('./template');
var config = require('../config');

var REPORT_SUMMARY_TEMPLATE = require('./summary.tpl.js').REPORT_SUMMARY_TEMPLATE;
var NODELOAD_CONFIG = config.NODELOAD_CONFIG;
var START = NODELOAD_CONFIG.START;
var DYGRAPH_SOURCE = require('./dygraph.tpl.js').DYGRAPH_SOURCE;
}
var Chart;

/** A Report contains a summary object and set of charts. It can be easily updated using the stats from
a monitor.js#Monitor or monitor.js#MonitorGroup using updateFromMonitor()/updateFromMonitorGroup().

@param name A name for the report. Generally corresponds to the test name.
@param updater A function(report) that should update the summary and chart data. */
var Report = exports.Report = function(name) {
    this.name = name;
    this.uid = util.uid();
    this.summary = {};
    this.charts = {};
};
Report.prototype = {
    getChart: function(name) {
        if (!this.charts[name]) {
            this.charts[name] = new Chart(name);
        }
        return this.charts[name];
    },
    /** Update this report automatically each time the Monitor emits an 'update' event */
    updateFromMonitor: function(monitor) {
        monitor.on('update', this.doUpdateFromMonitor_.bind(this, monitor, ''));
        return this;
    },
    /** Update this report automatically each time the MonitorGroup emits an 'update' event */
    updateFromMonitorGroup: function(monitorGroup) {
        var self = this;
        monitorGroup.on('update', function() {
            util.forEach(monitorGroup.monitors, function(monitorname, monitor) {
                self.doUpdateFromMonitor_(monitor, monitorname);
            });
        });
        return self;
    },
    doUpdateFromMonitor_: function(monitor, monitorname) {
        var self = this;
        monitorname = monitorname ? monitorname + ' ' : '';
        util.forEach(monitor.stats, function(statname, stat) {
            util.forEach(stat.summary(), function(name, val) {
                self.summary[self.name + ' ' + monitorname + statname + ' ' + name] = val;
            });
            if (monitor.interval[statname]) {
                self.getChart(monitorname + statname)
                    .put(monitor.interval[statname].summary());
            }
        });
    }
};

/** A Chart represents a collection of lines over time represented as:

    columns: ["x values", "line 1", "line 2", "line 3", ...]
    rows:   [[timestamp1, line1[0], line2[0], line3[0], ...],
             [timestamp2, line1[1], line2[1], line3[1], ...],
             [timestamp3, line1[2], line2[2], line3[2], ...],
             ...
            ]

@param name A name for the chart */
var Chart = exports.Chart = function(name) {
    this.name = name;
    this.uid = util.uid();
    this.columns = ["time"];
    this.rows = [[Date.now()]];
};
Chart.prototype = {
    /** Put a row of data into the chart. The current time will be used as the x-value. The lines in the
    chart are extracted from the "data". New lines can be added to the chart at any time by including it
    in data.

    @param data An object representing one row of data: {
                    "line name 1": value1
                    "line name 2": value2
                    ...
                }
    */
    put: function(data) {
        var self = this, row = [Date.now()]; 
        util.forEach(data, function(column, val) {
            var col = self.columns.indexOf(column);
            if (col < 0) {
                col = self.columns.length;
                self.columns.push(column);
                self.rows[0].push(0);
            }
            row[col] = val;
        });
        self.rows.push(row);
    },
    /** Update chart using data from event emitter each time it emits an event. 'eventEmitter' should 
    emit the given 'event' (defaults to 'data') with a single object. 'fields' are read from the object
    and added to the chart. For example, a chart can track the output form a child process output using
      
      chart.updateFromEventEmitter(spawnAndMonitor('cmd', ['args'], /val: (.*)/, ['val']), ['val'])
      
    */
    updateFromEventEmitter: function(eventEmitter, fields, event) {
        var self = this;
        eventEmitter.on(event || 'data', function(data) {
            var row = {};
            fields.forEach(function(i) {
                if (data[i] !== undefined) { row[i] = data[i]; }
            });
            self.put(row);
        });
    }
};

var ReportGroup = exports.ReportGroup = function() {
    this.reports = [];
    this.logNameOrObject = 'results-' + START.toISOString() + '.html';
};
ReportGroup.prototype = {
    addReport: function(report) {
        report = (typeof report === 'string') ? new Report(report) : report;
        this.reports.push(report);
        return report;
    },
    getReport: function(report) {
        var reports = this.reports.filter(function(r) { return r.name === report; });
        return reports[0] || this.addReport(report);
    },
    setLogFile: function(logNameOrObject) {
        this.logNameOrObject = logNameOrObject;
    },
    setLoggingEnabled: function(enabled) {
        clearTimeout(this.loggingTimeoutId);
        if (enabled) {
            this.logger = this.logger || (typeof this.logNameOrObject === 'string') ? new LogFile(this.logNameOrObject) : this.logNameOrObject;
            this.loggingTimeoutId = setTimeout(this.writeToLog_.bind(this), this.refreshIntervalMs);
        } else if (this.logger) {
            this.logger.close();
            this.logger = null;
        }
        return this;
    },
    reset: function() {
        this.reports = {};
    },
    getHtml: function() {
        var self = this,
            t = template.create(REPORT_SUMMARY_TEMPLATE);
        return t({
            DYGRAPH_SOURCE: DYGRAPH_SOURCE,
            querystring: querystring,
            refreshPeriodMs: self.refreshIntervalMs, 
            reports: self.reports
        });
    },
    writeToLog_: function() {
        this.loggingTimeoutId = setTimeout(this.writeToLog_.bind(this), this.refreshIntervalMs);
        this.logger.clear(this.getHtml());
    }
};// This file defines REPORT_MANAGER
//
// Reports added to the global REPORT_MANAGER are served by the global HTTP_SERVER instance (defaults to
// http://localhost:8000/) and written to disk at regular intervals.

var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var ReportGroup = require('./report').ReportGroup;
var config = require('../config');

var NODELOAD_CONFIG = config.NODELOAD_CONFIG;
var HTTP_SERVER = require('../http').HTTP_SERVER;
}

/** A global report manager used by nodeload to keep the summary webpage up to date during a load test */
var REPORT_MANAGER = exports.REPORT_MANAGER = new ReportGroup();
NODELOAD_CONFIG.on('apply', function() { 
    REPORT_MANAGER.refreshIntervalMs = REPORT_MANAGER.refreshIntervalMs || NODELOAD_CONFIG.AJAX_REFRESH_INTERVAL_MS;
    REPORT_MANAGER.setLoggingEnabled(NODELOAD_CONFIG.LOGS_ENABLED);
});

HTTP_SERVER.addRoute('^/$', function(url, req, res) {
    var html = REPORT_MANAGER.getHtml();
    res.writeHead(200, {"Content-Type": "text/html", "Content-Length": html.length});
    res.write(html);
    res.end();
});
HTTP_SERVER.addRoute('^/reports$', function(url, req, res) {
    var json = JSON.stringify(REPORT_MANAGER.reports); 
    res.writeHead(200, {"Content-Type": "application/json", "Content-Length": json.length});
    res.write(json);
    res.end();
});/*jslint forin:true */

var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var child_process = require('child_process');
var REPORT_MANAGER = require('./reportmanager').REPORT_MANAGER;
var util = require('../util');
var path = require('path');
}

var monitorProcess;

var monitorJmx = exports.monitorJmx = function(options) {
  // Verify that java & jmxstat jar can be found. Search for jmxstat/jmxstat.jar located next to the
  // current module or a parent module that included it.
  var m = module;
  var jmxstat, found = false;
  while (m && !found) {
    jmxstat = path.join(path.dirname(m.filename), 'jmxstat/jmxstat.jar');
    found = path.existsSync(jmxstat);
    m = m.parent;
  }
  if (!found) {
    throw new Error('jmxstat/jmxstat.jar not found.');
  }
  
  // Build command line args, output regex, and field labels
  var regex = '\\d{2}:\\d{2}:\\d{2}', columns = [], mbeans = [];
  for (var mbean in options.mbeans) {
    regex += '\\t([^\\t]*)';
    columns.push(mbean);
    mbeans.push(options.mbeans[mbean]);
  }
    
  // Start jmxstat
  var interval = options.interval || '';
  return monitorProcess({
    command: 'java -jar ' + jmxstat + ' ' + options.host + ' ' + mbeans.join(' ') + ' ' + interval,
    columns: columns,
    regex: regex,
    dataFormatter: options.dataFormatter
  });
};
var graphJmx = exports.graphJmx = function(options) {
  var report = REPORT_MANAGER.getReport(options.reportName || options.host || 'Monitor'),
      graph = report.getChart(options.chartName || 'JMX'),
      jmx = monitorJmx(options);

  jmx.on('data', function (data) { graph.put(data); });
  return jmx;
};

/** Spawn a child process, extract data using a regex, and graph the results on the summary report.
Returns a standard ChildProcess object.
*/
var monitorProcess = exports.monitorProcess = function(options) {
  var delimiter = options.delimiter || ' +',
    columns = options.columns || [],
    fieldRegex = columns.map(function() { return '([0-9.e+-]+)'; }).join(delimiter), // e.g. ([0-9.e+-]*) +([0-9.e+-]*) +...
    regex = options.regex || ('^ *' + fieldRegex),
    splitIdx = columns.indexOf(options.splitBy) + 1;

  var valuesToNumber = function(o) { 
    for (var i in o) {
      o[i] = Number(Number(o[i]).toFixed(2));
    }
    return o; 
  };

  var format = options.dataFormatter || valuesToNumber;
  var proc = child_process.spawn('/bin/bash', ['-c', options.command], options.spawnOptions),
    lr = new util.LineReader(proc.stdout);
  
  lr.on('data', function (line) {
    var vals = line.match(regex);
    if (vals) {
      var obj = {}, prefix = '';
      if (splitIdx > 0 && vals[splitIdx]) {
        prefix = vals[splitIdx] + ' ';
      }
      for (var i = 1; i < vals.length; i++) {
        if (columns[i-1]) {
          obj[prefix + columns[i-1]] = vals[i];
        }
      }
      obj = format(obj);
      if (obj) { proc.emit('data', obj); }
    }
  });

  return proc;
};
var graphProcess = exports.graphProcess = function(options) {
  var report = REPORT_MANAGER.getReport(options.reportName || 'Monitor'),
      graph = report.getChart(options.chartName || options.command),
      proc = monitorProcess(options);
  
  proc.on('data', function (data) { graph.put(data); });
  return proc;
};// ------------------------------------
// Main HTTP load testing interface
// ------------------------------------
//
// This file defines run(), LoadTest, createClient() and extendClient().
//
// This file defines the main API for using nodeload to construct load tests. The main function for 
// starting a load test is run(). Nodeload modules, such as monitoring.js and reporting.js, can also be
// used independently.
//
/*jslint laxbreak: true */
var BUILD_AS_SINGLE_FILE;
if (BUILD_AS_SINGLE_FILE === undefined) {
var http = require('http');
var util = require('./util');
var stats = require('./stats');
var reporting = require('./reporting');
var qputs = util.qputs;
var qprint = util.qprint;
var EventEmitter = require('events').EventEmitter;
var MultiLoop = require('./loop').MultiLoop;
var Monitor = require('./monitoring').Monitor;
var Report = reporting.Report;
var LogFile = stats.LogFile;

var NODELOAD_CONFIG = require('./config').NODELOAD_CONFIG;
var START = NODELOAD_CONFIG.START;
var REPORT_MANAGER = reporting.REPORT_MANAGER;
var HTTP_SERVER = require('./http').HTTP_SERVER;
}

/** TEST_OPTIONS defines all of the parameters that can be set in a test specifiction passed to
run(). By default (calling require('nodeload').run({});), will GET localhost:8080/ as fast as possible
with 10 users for 2 minutes. */
var TEST_OPTIONS = {
    name: 'Debug test',                     // A descriptive name for the test

                                            // Specify one of:
    host: 'localhost',                      //   1. (host, port) to connect to via HTTP
    port: 8080,                             //
                                            //
    connectionGenerator: undefined,         //   2. connectionGenerator(), called once for each user. 
                                            //      The return value is passed as-is to requestGenerator,
                                            //      requestLoop, or used internally to generate requests
                                            //      when using (method + path + requestData).
                                            
                                            // Specify one of:
    requestGenerator: undefined,            //   1. requestGenerator: a function
                                            //         function(http.Client) ->  http.ClientRequest
    requestLoop: undefined,                 //   2. requestLoop: is a function
                                            //         function(finished, http.Client)
    method: 'GET',                          //     If must call:
    path: '/',                              //         finished({
    requestData: undefined,                 //             req: http.ClientRequest, 
                                            //             res: http.ClientResponse});
                                            //     after each transaction to finishes to schedule the 
                                            //     next iteration of requestLoop.
                                            //   3. (method + path + requestData) specify a single URL to
                                            //     test
                                            //
    
                                            // Specify one of:
    numUsers: 10,                           //   1. numUsers: number of virtual users concurrently
                                            //      executing therequest loop
    loadProfile: undefined,                 //   2. loadProfile: array with requests/sec over time:
                                            //        [[time (seconds), rps], [time 2, rps], ...]
                                            //      For example, ramp up from 100 to 500 rps and then
                                            //      down to 0 over 20 seconds:
                                            //        [[0, 100], [10, 500], [20, 0]]
                                            
                                            // Specify one of:
    targetRps: Infinity,                    //   1. targetRps: times per second to execute request loop
    userProfile: undefined,                 //   2. userProfile: array with number of users over time:
                                            //        [[time (seconds), # users], [time 2, users], ...]
                                            //      For example, ramp up from 0 to 100 users and back
                                            //      down to 0 over 20 seconds:
                                            //        [[0, 0], [10, 100], [20, 0]]

    numRequests: Infinity,                  // Maximum number of iterations of request loop
    timeLimit: 120,                         // Maximum duration of test in seconds
    delay: 0,                               // Seconds before starting test

    stats: ['latency',                      // Specify list of: 'latency', 'result-codes', 'uniques', 
            'result-codes'],                // 'concurrency', 'http-errors'. These following statistics
                                            // may also be specified with parameters:
                                            //
                                            //     { name: 'latency', percentiles: [0.9, 0.99] }
                                            //     { name: 'http-errors', successCodes: [200,404], log: 'http-errors.log' }
                                            //
                                            // Extend this list of statistics by adding to the
                                            // monitor.js#Monitor.Monitors object.
                                            //
                                            // Note:
                                            // - for 'uniques', traceableRequest() must be used
                                            //   to create the ClientRequest or only 2 will be detected.
};

var LoadTest, generateConnection, requestGeneratorLoop;

/** run(spec, ...) is the primary method for creating and executing load tests with nodeload. See
TEST_OPTIONS for a list of the configuration values in each specification.

@return A LoadTest object with start() / stop() methods, emits 'start' / 'end', and holds statistics
        in .interval and .stats. See LoadTest below.
*/
var run = exports.run = function(specs) {
    specs = (specs instanceof Array) ? specs : util.argarray(arguments);
    var tests = specs.map(function(spec) {
        spec = util.defaults(spec, TEST_OPTIONS);
        var generateRequest = function(client) {
                if (spec.requestGenerator) { return spec.requestGenerator(client); }
                var request = client.request(spec.method, spec.path, { 'host': spec.host });
                if (spec.requestData) {
                    request.write(spec.requestData);
                }
                return request;
            },
            loop = new MultiLoop({
                fun: spec.requestLoop || requestGeneratorLoop(generateRequest),
                argGenerator: spec.connectionGenerator || generateConnection(spec.host, spec.port, !spec.requestLoop),
                concurrencyProfile: spec.userProfile || [[0, spec.numUsers]],
                rpsProfile: spec.loadProfile || [[0, spec.targetRps]],
                duration: spec.timeLimit,
                numberOfTimes: spec.numRequests,
                delay: spec.delay
            }),
            monitor = new Monitor(spec.stats),
            report = new Report(spec.name).updateFromMonitor(monitor);

        loop.on('add', function(loops) { 
            monitor.monitorObjects(loops, 'startiteration', 'enditeration');
        });
        REPORT_MANAGER.addReport(report);
        monitor.name = spec.name;
        monitor.setLoggingEnabled(NODELOAD_CONFIG.LOGS_ENABLED);
        
        return {
            spec: spec,
            loop: loop,
            monitor: monitor,
            report: report,
        };
    });
    
    var loadtest = new LoadTest(tests).start();
    return loadtest;
};

/** LoadTest can be started & stopped. Starting it will fire up the global HTTP_SERVER if it is not
started. Stopping LoadTest will shut HTTP_SERVER down. The expectation is that only one LoadTest instance
is normally running at a time, and when the test finishes, you usually want to let the process end, which
requires stopping HTTP_SERVER. Set loadtest.keepAlive=true to not shut down HTTP_SERVER when done.

LoadTest contains the members:

    - tests: a list of the test objects created by run() from each spec, which contains:
        spec: original specification used by run to create this test object
        loop: a MultiLoop instance that represents all the "vusers" for this job
        monitor: a Monitor instance tracking stats from the MultiLoop instance, loop
        report: a Report which is tracked by REPORT_MANAGER holding a chart for every stat in monitor
    - interval: statistics gathered since the last 'update' event
    - stats: cumulative statistics
    - updateInterval: milliseconds between 'update' events, which includes statistics from the previous 
      interval as well as overall statistics. Defaults to 2 seconds.

LoadTest emits these events:

- 'update', interval, stats: interval has stats since last update. stats contains overall stats.
- 'end': all tests finished

*/
var LoadTest = exports.LoadTest = function LoadTest(tests) {
    EventEmitter.call(this);
    util.PeriodicUpdater.call(this);
    
    var self = this;
    self.tests = tests;
    self.updateInterval = NODELOAD_CONFIG.MONITOR_INTERVAL_MS;
    self.interval = {};
    self.stats = {};
    self.tests.forEach(function(test) {
        self.interval[test.spec.name] = test.monitor.interval;
        self.stats[test.spec.name] = test.monitor.stats;
    });
    self.finishChecker_ = this.checkFinished_.bind(this);
};

util.inherits(LoadTest, EventEmitter);

/** Start running the load test. Starts HTTP_SERVER if it is stopped (unless disabled globally). */
LoadTest.prototype.start = function(keepAlive) {
    var self = this;
    self.keepAlive = keepAlive;

    // clients can catch 'start' event even after calling start().
    process.nextTick(self.emit.bind(self, 'start'));
    self.tests.forEach(function(test) {
        test.loop.start();
        test.loop.on('end', self.finishChecker_);
    });
    
    if (!HTTP_SERVER.running && NODELOAD_CONFIG.HTTP_ENABLED) {
        HTTP_SERVER.start(NODELOAD_CONFIG.HTTP_PORT);
    }

    return self;
};

/** Force the load test to stop. */
LoadTest.prototype.stop = function() {
    this.tests.forEach(function(t) { t.loop.stop(); });
    return this;
};

LoadTest.prototype.update = function() {
    this.emit('update', this.interval, this.stats);
    this.tests.forEach(function(t) { t.monitor.update(); });
    qprint('.');
};

LoadTest.prototype.checkFinished_ = function() {
    if (this.tests.some(function(t) { return t.loop.running; })) { return; }

    this.updateInterval = 0;
    this.update();
    qputs('Done.');

    if (!this.keepAlive) { 
        HTTP_SERVER.stop();
    }

    this.emit('end');
};

/** extendClient extends an existing instance of http.Client by noting the request method and path.
Writing to new requests also emits the 'write' event. This client must be used when using nodeload to
when tracking 'uniques' and 'request-bytes'. */
var extendClient = exports.extendClient = function(client) {
    var wrappedRequest = client.request;
    client.request = function(method, url) {
        var request = wrappedRequest.apply(client, arguments),
            wrappedWrite = request.write,
            wrappedEnd = request.end,
            track = function(data) {
                if (data) {
                    request.emit('write', data);
                    request.body += data.toString();
                }
            };
        request.method = method;
        request.path = url;
        request.body = '';
        request.write = function(data, encoding) {
            track(data);
            return wrappedWrite.apply(request, arguments);
        };
        request.end = function(data, encoding) {
            track(data);
            return wrappedEnd.apply(request, arguments);
        };
        return request;
    };
    return client;
};

/** Same arguments as http.createClient. Returns an extended version of the object (see extendClient) */
var createClient = exports.createClient = function() {
    return extendClient(util.createReconnectingClient.apply(this, arguments));
};

/** Creates a new HTTP connection. This is used as an argGenerator for LoadTest's MultiLoop, so each
"user" gets its own connection. If the load test is using requestGeneratorLoop to generate its requests,
then we also need to terminate pending requests when client errors occur. We emit a fake 'response'
event, so that requestGeneratorLoop can finish its iteration. */
function generateConnection(host, port, detectClientErrors) {
    return function() {
        var client = createClient(port, host);
        if (detectClientErrors) {
            // we need to detect client errors if we're managing the request generation
            client.on('error', function(err) {
                qputs('WARN: Error during HTTP request: ' + (err ? err.toString() : 'unknown'));
            });
            client.on('reconnect', function(oldclient) {
                // For each pending outgoing request, simulate an empty response
                if (oldclient._outgoing) {
                    oldclient._outgoing.forEach(function(req) {
                        if (req instanceof http.ClientRequest) {
                            req.emit('response', new EventEmitter());
                        }
                    });
                }
            });
        }
        return client;
    };
}

/** Wrapper for request generator function, generator

@param generator A function:

                     function(http.Client) -> http.ClientRequest

                 The http.Client is provided by nodeload. The http.ClientRequest may contain an extra
                 .timeout field specifying the maximum milliseconds to wait for a response.

@return A Loop compatible function, function(loopFun, http.Client). Each iteration makes an HTTP
        request by calling generator. loopFun({req: http.ClientRequest, res: http.ClientResponse}) is
        called when the HTTP response is received or the request times out. */
function requestGeneratorLoop(generator) {
    return function(finished, client) {
        var running = true, timeoutId, request = generator(client);
        var callFinished = function(response) {
            if (running) { 
                running = false;
                clearTimeout(timeoutId);
                response.statusCode = response.statusCode || 0;
                finished({req: request, res: response});
            }
        };
        if (request) {
            if (request.timeout > 0) {
                timeoutId = setTimeout(function() {
                                callFinished(new EventEmitter());
                            }, request.timeout);
            }
            request.on('response', function(response) {
                callFinished(response);
            });
            request.end();
        } else {
            finished(null);
        }
    };
}/*jslint sub: true */
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var url = require('url');
var util = require('../util');
var EventEmitter = require('events').EventEmitter;
}

/** Endpoint represents an a collection of functions that can be executed by POSTing parameters to an
HTTP server.

When Endpoint is started it adds the a unique route, /remote/{uid}/{method}, to server.
When a POST request is received, it calls method() with the request body as it's parameters.

The available methods for this endpoint are defined by calling defineMethod(...).

Endpoint emits the following events:
- 'start': A route has been installed on the HTTP server and setup(), if defined through defineMethod(),
    has been called
- 'end': The route has been removed. No more defined methods will be called.

Endpoint.state can be:
- 'initialized': This endpoint is ready to be started.
- 'started': This endpoint is listening for POST requests to dispatching to the corresponding methods
*/
var Endpoint = exports.Endpoint = function Endpoint(server, hostAndPort) {
    EventEmitter.call(this);

    var self = this, 
        parts = hostAndPort ? hostAndPort.split(':') : [];

    self.id = util.uid();
    self.server = server;
    self.methodNames = [];
    self.methods = {};
    self.setStaticParams([]);
    self.state = 'initialized';
    self.__defineGetter__('url', function() { return self.url_; });

    self.hostname_ = parts[0];
    self.port_ = parts[1];
    self.basepath_ = '/remote/' + self.id;
    self.handler_ = self.handle.bind(self);
};

util.inherits(Endpoint, EventEmitter);

/** Set values that are passed as the initial arguments to every handler method. For example, if you:

    var id = 123, name = 'myobject';
    endpoint.setStaticParams([id, name]);

You should define methods:

    endpoint.defineMethod('method_1', function(id, name, arg1, arg2...) {...});

which are called by:

    endpoint.method_1(arg1, arg2...)

*/
Endpoint.prototype.setStaticParams = function(params) {
    this.staticParams_ = params instanceof Array ? params : [params];
};

/** Define a method that can be executed by POSTing to /basepath/method-name. For example:

    endpoint.defineMethod('method_1', function(data) { return data; });

then POSTing '[123]' to /{basepath}/method_1 will respond with a message with body 123.

*/
Endpoint.prototype.defineMethod = function(name, fun) {
    this.methodNames.push(name);
    this.methods[name] = fun;
};

/** Start responding to requests to this endpoint by adding the proper route to the HTTP server*/
Endpoint.prototype.start = function() {
    if (this.state !== 'initialized') { return; }
    this.url_ = url.format({
        protocol: 'http', 
        hostname: this.hostname_ || this.server.hostname,
        port: this.port_ || this.server.port,
        pathname: this.basepath_
    });
    this.route_ = '^' + this.basepath_ + '/?';
    this.server.addRoute(this.route_, this.handler_);
    this.context = {};
    if (this.methods['setup']) {
        this.methods['setup'].apply(this.context, this.staticParams_);
    }
    this.state = 'started';
    this.emit('start');
};

/** Remove the HTTP server route and stop responding to requests */
Endpoint.prototype.end = function() {
    if (this.state !== 'started') { return; }
    this.server.removeRoute(this.route_, this.handler_);
    this.state = 'initialized';
    this.emit('end');
};

/** The main HTTP request handler. On DELETE /{basepath}, it will self-destruct this endpoint. POST 
requests are routed to the function set by defineMethod(), applying the HTTP request body as parameters,
and sending return value back in the HTTP response. */
Endpoint.prototype.handle = function(path, req, res) {
    var self = this;
    if (path === self.basepath_) {
        if (req.method === 'DELETE') {
            self.end();
            res.writeHead(204, {'Content-Length': 0});
            res.end();
        } else {
            res.writeHead(405);
            res.end();
        }
    } else if (req.method === 'POST') {
        var method = path.slice(this.basepath_.length+1);
        if (self.methods[method]) {
            util.readStream(req, function(params) {
                var status = 200, ret;
                
                try {
                    params = JSON.parse(params);
                } catch(e1) {
                    res.writeHead(400);
                    res.end();
                    return;
                }
                
                params = (params instanceof Array) ? params : [params];
                ret = self.methods[method].apply(self.context, self.staticParams_.concat(params));

                try {
                    ret = (ret === undefined) ? '' : JSON.stringify(ret);
                } catch(e2) {
                    ret = e2.toString();
                    status = 500;
                }

                res.writeHead(status, {'Content-Length': ret.length, 'Content-Type': 'application/json'});
                res.end(ret);
            });
        } else {
            res.writeHead(404);
            res.end();
        }
    } else {
        res.writeHead(405);
        res.end();
    }
};var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var http = require('http');
var util = require('../util');
var EventEmitter = require('events').EventEmitter;
var qputs = util.qputs;
}

var DEFAULT_RETRY_INTERVAL_MS = 2000;

/** EndpointClient represents an HTTP connection to an Endpoint. The supported methods should be added
by calling defineMethod(...). For example,

    client = new EndpointClient('myserver', 8000, '/remote/0');
    client.defineMethod('method_1');
    client.on('connect', function() {
        client.method_1(args);
    });

will send a POST request to http://myserver:8000/remote/0/method_1 with the body [args], which causes
the Endpoint listening on myserver to execute method_1(args).

EndpointClient emits the following events:
- 'connect': An HTTP connection to the remote endpoint has been established. Methods may now be called.
- 'clientError', Error: The underlying HTTP connection returned an error. The connection will be retried.
- 'clientError', http.ClientResponse: A call to a method on the endpoint returned this non-200 response.
- 'end': The underlying HTTP connect has been terminated. No more events will be emitted.
*/
var EndpointClient = exports.EndpointClient = function EndpointClient(host, port, basepath) {
    EventEmitter.call(this);
    this.host = host;
    this.port = port;
    this.client = util.createReconnectingClient(port, host);
    this.client.on('error', this.emit.bind(this, 'error'));
    this.basepath = basepath || '';
    this.methodNames = [];
    this.retryInterval = DEFAULT_RETRY_INTERVAL_MS;
    this.setStaticParams([]);
};
util.inherits(EndpointClient, EventEmitter);
/** Terminate the HTTP connection. */
EndpointClient.prototype.destroy = function() {
    this.client.destroy();
    this.emit('end');
};
/** Send an arbitrary HTTP request using the underlying http.Client. */
EndpointClient.prototype.rawRequest = function() {
    return this.client.request.apply(this.client, arguments);
};
EndpointClient.prototype.setStaticParams = function(params) {
    this.staticParams_ = params instanceof Array ? params : [params];
};
/** Add a method that the target server understands. The method can be executed by calling 
endpointClient.method(args...). */
EndpointClient.prototype.defineMethod = function(name) {
    var self = this;
    self[name] = function() {
        var req = self.client.request('POST', self.basepath + '/' + name),
            params = self.staticParams_.concat(util.argarray(arguments));

        req.on('response', function(res) {
            if (res.statusCode !== 200) {
                self.emit('clientError', res);
            }
        });
        req.end(JSON.stringify(params));

        return req;
    };
    self.methodNames.push(name);
    return self;
};/*jslint sub: true */
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var url = require('url');
var util = require('../util');
var EventEmitter = require('events').EventEmitter;
var EndpointClient = require('./endpointclient').EndpointClient;
var NODELOAD_CONFIG = require('../config').NODELOAD_CONFIG;
}

/** Slave represents a remote slave instance from the master server's perspective. It holds the slave
method defintions, defined by calling defineMethod(), as Javascript strings. When start() is called,
the definitions are POSTed to /remote on the remote instance which causes the instance to create a new
endpoint with those methods. Subsequent calls to Slave simply POST parameters to the remote instance:

    slave = new Slave(...);
    slave.defineMethod('slave_method_1', function(master, name) { return 'hello ' + name });
    slave.start();
    slave.on('start', function() {
        slave.method_1('tom');
        slave.end();
    });

will POST the definition of method_1 to /remote, followed by ['tom'] to /remote/.../method_1.

Slave emits the following events:
- 'slaveError', error: The underlying HTTP connection returned an error.
- 'start': The remote instance accepted the slave definition and slave methods can now be called.
- 'end': The slave endpoint has been removed from the remote instance.

Slave.state can be:
- 'initialized': The slave is ready to be started.
- 'connecting': The slave definition is being sent to the remote instance.
- 'started': The remote instance is running and methods defined through defineMethod can be called. */
var Slave = exports.Slave = function Slave(id, host, port, masterEndpoint, pingInterval) {
    EventEmitter.call(this);
    this.id = id;
    this.client = new EndpointClient(host, port);
    this.client.on('error', this.emit.bind(this, 'slaveError'));
    this.masterEndpoint = masterEndpoint;
    this.pingInterval = pingInterval || NODELOAD_CONFIG.SLAVE_UPDATE_INTERVAL_MS;
    this.methodDefs = [];
    this.state = 'initialized';
};
util.inherits(Slave, EventEmitter);
/** POST method definitions and information about this instance (the slave's master) to /remote */
Slave.prototype.start = function() {
    if (this.masterEndpoint && this.masterEndpoint.state !== 'started') { 
        throw new Error('Slave must be started after its Master.'); 
    }

    var self = this,
        masterUrl = self.masterEndpoint ? self.masterEndpoint.url : null,
        masterMethods = self.masterEndpoint ? self.masterEndpoint.methodNames : [],
        req = self.client.rawRequest('POST', '/remote');

    req.end(JSON.stringify({ 
        id: self.id,
        master: masterUrl,
        masterMethods: masterMethods,
        slaveMethods: self.methodDefs,
        pingInterval: self.pingInterval
    }));
    req.on('response', function(res) {
        if (!res.headers['location']) {
            self.emit('error', new Error('Remote slave does not have proper /remote handler.'));
        }
        self.client.basepath = url.parse(res.headers['location']).pathname;
        self.state = 'started';
        self.emit('start');
    });
    
    self.state = 'connecting';
};
/** Stop this slave by sending a DELETE request to terminate the slave's endpoint. */
Slave.prototype.end = function() {
    var self = this, 
        req = self.client.rawRequest('DELETE', self.client.basepath),
        done = function() {
            self.client.destroy();
            self.client.basepath = '';
            self.state = 'initialized';
            self.emit('end');
        };

    self.client.once('error', function(e) { 
        self.emit('slaveError', e);
        done();
    });
    req.on('response', function(res) {
        if (res.statusCode !== 204) {
            self.emit('slaveError', new Error('Error stopping slave.'), res);
        }
        done();
    });
    req.end();
};
/** Define a method that will be sent to the slave instance */
Slave.prototype.defineMethod = function(name, fun) {
    var self = this;
    self.client.defineMethod(name, fun);
    self[name] = function() { return self.client[name].apply(self.client, arguments); };
    self.methodDefs.push({name: name, fun: fun.toString()});
};var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var Slave = require('./slave').Slave;
var EventEmitter = require('events').EventEmitter;
}

/** A small wrapper for a collection of Slave instances. The instances are all started and stopped 
together and method calls are sent to all the instances.

Slaves emits the following events:
- 'slaveError', slave, error: The underlying HTTP connection for this slave returned an error.
- 'start': All of the slave instances are running.
- 'stopped': All of the slave instances have been stopped. */

var Slaves = exports.Slaves = function Slaves(masterEndpoint, pingInterval) {
    EventEmitter.call(this);
    this.masterEndpoint = masterEndpoint;
    this.slaves = [];
    this.pingInterval = pingInterval;
};
util.inherits(Slaves, EventEmitter);
/** Add a remote instance in the format 'host:port' as a slave in this collection */
Slaves.prototype.add = function(hostAndPort) {
    var self = this, 
        parts = hostAndPort.split(':'), 
        host = parts[0],
        port = Number(parts[1]) || 8000,
        id = host + ':' + port,
        slave = new Slave(id, host, port, self.masterEndpoint, self.pingInterval);

    self.slaves.push(slave);
    self[id] = slave;
    self[id].on('slaveError', function(err) {
        self.emit('slaveError', slave, err);
    });
    self[id].on('start', function() {
        var allStarted = util.every(self.slaves, function(id, s) { return s.state === 'started'; });
        if (!allStarted) { return; }
        self.emit('start');
    });
    self[id].on('end', function() {
        var allStopped = util.every(self.slaves, function(id, s) { return s.state !== 'started'; });
        if (!allStopped) { return; }
        self.emit('end');
    });
};
/** Define a method on all the slaves */
Slaves.prototype.defineMethod = function(name, fun) {
    var self = this;

    self.slaves.forEach(function(slave) {
        slave.defineMethod(name, fun);
    });

    self[name] = function() {
        var args = arguments;
        return self.slaves.map(function(s) { return s[name].apply(s, args); });
    };
};
/** Start all the slaves */
Slaves.prototype.start = function() {
    this.slaves.forEach(function(s) { s.start(); });
};
/** Terminate all the slaves */
Slaves.prototype.end = function() {
    this.slaves.forEach(function(s) { s.end(); });
};var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var url = require('url');
var util = require('../util');
var Endpoint = require('./endpoint').Endpoint;
var EndpointClient = require('./endpointclient').EndpointClient;
var EventEmitter = require('events').EventEmitter;
var NODELOAD_CONFIG = require('../config').NODELOAD_CONFIG;
}

/** An instance of SlaveNode represents a slave from the perspective of a slave (as opposed to 
slave.js#Slave, which represents a slave from the perspective of a master). When a slave.js#Slave object
is started, it sends a slave specification to the target machine, which uses the specification to create
a SlaveNode. The specification contains:

    {
        id: master assigned id of this node,
        master: 'base url of master endpoint, e.g. /remote/0',
        masterMethods: ['list of method name supported by master'],
        slaveMethods: [
            { name: 'method-name', fun: 'function() { valid Javascript in a string }' }
        ],
        pingInterval: milliseconds between sending the current execution state to master
    }

If the any of the slaveMethods contain invalid Javascript, this constructor will throw an exception.

SlaveNode emits the following events:
- 'start': The endpoint has been installed on the HTTP server and connection to the master has been made
- 'masterError': The HTTP connection to the master node returned an error.
- 'end': The local endpoint has been removed and the connection to the master server terminated 
*/
var SlaveNode = exports.SlaveNode = function SlaveNode(server, spec) {
    EventEmitter.call(this);
    util.PeriodicUpdater.call(this);

    var self = this, slaveState = 'initialized';
    this.id = spec.id;
    this.masterClient_ = spec.master ? this.createMasterClient_(spec.master, spec.masterMethods) : null;
    this.slaveEndpoint_ = this.createEndpoint_(server, spec.slaveMethods);
    this.slaveEndpoint_.setStaticParams([this.masterClient_]);
    this.slaveEndpoint_.on('start', function() { this.emit.bind(this, 'start'); });
    this.slaveEndpoint_.on('end', this.end.bind(this));

    this.slaveEndpoint_.start();
    this.slaveEndpoint_.context.id = this.id;
    this.slaveEndpoint_.context.__defineGetter__('state', function() { return slaveState; });
    this.slaveEndpoint_.context.__defineSetter__('state', function(val) { 
        slaveState = val;
        self.update();
    });
    this.url = this.slaveEndpoint_.url;

    this.updateInterval = (spec.pingInterval >= 0) ? spec.pingInterval : NODELOAD_CONFIG.SLAVE_UPDATE_INTERVAL_MS;
};
util.inherits(SlaveNode, EventEmitter);
SlaveNode.prototype.end = function() {
    this.updateInterval = 0;
    this.slaveEndpoint_.end();
    if (this.masterClient_) {
        this.masterClient_.destroy();
    }
    this.emit('end');
};
SlaveNode.prototype.update = function() {
    if (this.masterClient_) {
        this.masterClient_.updateSlaveState_(this.slaveEndpoint_.context.state);
    }
};
SlaveNode.prototype.createEndpoint_ = function(server, methods) {
    // Add a new endpoint and route to the HttpServer
    var endpoint = new Endpoint(server);
    
    // "Compile" the methods by eval()'ing the string in "fun", and add to the endpoint
    if (methods) {
        try {
            methods.forEach(function(m) {
                var fun;
                eval('fun=' + m.fun);
                endpoint.defineMethod(m.name, fun);
            });
        } catch (e) {
            endpoint.end();
            endpoint = null;
            throw e;
        }
    }
    
    return endpoint;
};
SlaveNode.prototype.createMasterClient_ = function(masterUrl, methods) {
    var parts = url.parse(masterUrl),
        masterClient = new EndpointClient(parts.hostname, Number(parts.port) || 8000, parts.pathname);

    masterClient.defineMethod('updateSlaveState_');
    if (methods && methods instanceof Array) {
        methods.forEach(function(m) { masterClient.defineMethod(m); });
    }

    // send this slave's id as the first parameter for all method calls to master
    masterClient.setStaticParams([this.id]);

    masterClient.on('error', this.emit.bind(this, 'masterError'));
    return masterClient;
};


/** Install the /remote URL handler, which creates a slave endpoint. On receiving a POST request to
/remote, a new route is added to HTTP_SERVER using the handler definition provided in the request body.
See #SlaveNode for a description of the handler defintion. */
var installRemoteHandler = exports.installRemoteHandler = function(server) {
    var slaveNodes = [];
    server.addRoute('^/remote/?$', function(path, req, res) {
        if (req.method === 'POST') {
            util.readStream(req, function(body) {
                var slaveNode;

                // Grab the slave endpoint definition from the HTTP request body; should be valid JSON
                try {
                    body = JSON.parse(body);
                    slaveNode = new SlaveNode(server, body);
                } catch(e) {
                    res.writeHead(400);
                    res.end(e.toString());
                    return;
                }

                slaveNodes.push(slaveNode);
                slaveNode.on('end', function() {
                    var idx = slaveNodes.indexOf(slaveNode);
                    if (idx !== -1) { slaveNodes.splice(idx, 1); }
                });

                res.writeHead(201, {
                    'Location': slaveNode.url, 
                    'Content-Length': 0,
                });
                res.end();
            });
        } else if (req.method === 'GET') {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify(slaveNodes.map(function(s) { return s.url; })));
        } else {
            res.writeHead(405);
            res.end();
        }
    });
};var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var Endpoint = require('./endpoint').Endpoint;
var EventEmitter = require('events').EventEmitter;
var SlaveNode = require('./slavenode').SlaveNode;
var Slaves = require('./slaves').Slaves;
var qputs = util.qputs;
var HTTP_SERVER = require('../http').HTTP_SERVER;
var NODELOAD_CONFIG = require('../config').NODELOAD_CONFIG;
}

/** Main interface for creating a distributed nodeload cluster. Spec:
{ 
    master: {
        host: 'host' or 'host:port' or undefined to extract from HttpServer
        master_remote_function_1: function(slaves, slaveId, args...) { ... },
    },
    slaves: {
        host: ['host:port', ...],
        setup: function(master) { ... }
        slave_remote_function_1: function(master, args...) { ... }
    },
    pingInterval: 2000,
    server: HttpServer instance (defaults to global HTTP_SERVER)
}

Calling cluster.start() will register a master handler on the provided http.js#HttpServer. It will
connect to every slave, asking each slave to 1) execute the setup() function, 2) report its current
state to this host every pingInterval milliseconds. Calling cluster.slave_remote_function_1(), will
execute slave_remote_function_1 on every slave.

Cluster emits the following events:

- 'init': emitted when the cluster.start() can be called (the underlying HTTP server has been started).
- 'start': when connections to all the slave instances have been established
- 'end': when all the slaves have been terminated (e.g. by calling cluster.end()). The endpoint
    installed in the underlying HTTP server has been removed.
- 'slaveError', slave, Error: The connection to the slave experienced an error. If error is null, the
    slave has failed to send its state in the last 4 pingInterval periods. It should be considered
    unresponsive.
- 'slaveError', slave, http.ClientResponse: A method call to this slave returned this non-200 response.
- 'running', 'done': when all the slaves that are not in an error state (haven't responded in the last 4
    pingIntervals) report that they are in a 'running' or 'done' state. To set a slave's the state,
    install a slave function:
    
        cluster = new Cluster({ 
            slaves: {
                slave_remote_function: function(master) { this.state = 'running'; }
            },
            ...
        });
    
    and call it
    
        cluster.slave_remote_function();
        
Cluster.state can be:
- 'initializing': The cluster cannot be started yet -- it is waiting for the HTTP server to start.
- 'initialized': The cluster can be started.
- 'started': Connections to all the slaves have been established and the master endpoint is created.
- 'stopping': Attempting to terminate all slaves.
- 'stopped': All of the slaves have been properly shutdown and the master endpoint removed.
*/
var Cluster = exports.Cluster = function Cluster(spec) {
    EventEmitter.call(this);
    util.PeriodicUpdater.call(this);
    
    var self = this,
        masterSpec = spec.master || {},
        slavesSpec = spec.slaves || { hosts:[] },
        masterHost = spec.master && spec.master.host || 'localhost';
    
    self.pingInterval = spec.pingInterval || NODELOAD_CONFIG.SLAVE_UPDATE_INTERVAL_MS;
    self.server = spec.server || HTTP_SERVER;
    self.masterEndpoint = new Endpoint(self.server, masterHost);
    self.slaves = new Slaves(self.masterEndpoint, self.pingInterval);
    self.slaveState_ = {};

    // Define all master methods on the local endpoint
    self.masterEndpoint.setStaticParams([self.slaves]); // 1st param to all master functions is slaves. 2nd will be slave id, which SlaveNode prepends to all requests.
    self.masterEndpoint.defineMethod('updateSlaveState_', self.updateSlaveState_.bind(self)); // updateSlaveState_ is on every master and called by SlaveNode.update() to periodically send its state to the master.
    util.forEach(masterSpec, function(method, val) {
        if (typeof val === 'function') {
            self.masterEndpoint.defineMethod(method, val);
        }
    });

    // Send all slave methods definitions to the remote instances
    slavesSpec.hosts.forEach(function(h) { self.slaves.add(h); });
    util.forEach(spec.slaves, function(method, val) {
        if (typeof val === 'function') {
            self.slaves.defineMethod(method, val);
            self[method] = function() { self.slaves[method].apply(self.slaves, arguments); };
        }
    });
    
    // Store some other extra state for each slave so we can detect state changes and unresponsiveness
    self.slaves.slaves.forEach(function(s) {
        if (!self.slaveState_[s.id]) {
            self.slaveState_[s.id] = { alive: true, aliveSinceLastCheck: false };
        }
    });

    // Cluster is started when slaves are alive, and ends when slaves are all shutdown
    self.slaves.on('start', function() { 
        self.state = 'started';
        self.emit('start'); 
    });
    self.slaves.on('end', function() { 
        self.masterEndpoint.end();
        self.state = 'stopped';
        self.emit('end'); 
    });
    self.slaves.on('slaveError', function(slave, err) {
        self.emit('slaveError', slave, err);
    });

    // Cluster is initialized (can be started) once server is started
    if (self.server.running) {
        self.state = 'initialized';
        process.nextTick(function() { self.emit('init'); });
    } else {
        self.state = 'initializing';
        self.server.on('start', function() {
            self.state = 'initialized';
            self.emit('init');
        });
    }
};
util.inherits(Cluster, EventEmitter);
Cluster.prototype.started = function() { return this.state === 'started'; };
/** Start cluster; install a route on the local HTTP server and send the slave definition to all the
slave instances. */
Cluster.prototype.start = function() {
    if (!this.server.running) { 
        throw new Error('A Cluster can only be started after it has emitted \'init\'.'); 
    }
    this.masterEndpoint.start();
    this.slaves.start();
    this.updateInterval = this.pingInterval * 4; // call update() every 4 ping intervals to check for slave aliveness
    // this.slaves 'start' event handler emits 'start' and updates state
};
/** Stop the cluster; remove the route from the local HTTP server and uninstall and disconnect from all
the slave instances */
Cluster.prototype.end = function() {
    this.state = 'stopping';
    this.updateInterval = 0;
    this.slaves.end();
    // this.slaves 'end' event handler emits 'end', destroys masterEndpoint & updates state
};
/** Check for unresponsive slaves that haven't called updateSlaveState_ in the last 4 update intervals */
Cluster.prototype.update = function() {
    var self = this;
    util.forEach(self.slaveState_, function(id, s) {
        if (!s.aliveSinceLastCheck && s.alive) {
            // this node has not sent us its state in the last four spec.pingInterval intervals -- mark as dead
            s.alive = false;
            self.emit('slaveError', self.slaves[id], null);
        } else if (s.aliveSinceLastCheck) {
            s.aliveSinceLastCheck = false;
            s.alive = true;
        }
    });
};
/** Receive a periodic state update message from a slave. When all slaves enter the 'running' or 'done'
states, emit an event. */
Cluster.prototype.updateSlaveState_ = function(slaves, slaveId, state) {
    var slave = slaves[slaveId];
    if (slave) {
        var previousState = this.slaveState_[slaveId].state;
        this.slaveState_[slaveId].state = state;
        this.slaveState_[slaveId].aliveSinceLastCheck = true;
        if (previousState !== state) {
            this.emit('slaveState', slave, state);

            if (state === 'running' || state === 'done') {
                this.emitWhenAllSlavesInState_(state); 
            }
        }
    } else {
        qputs('WARN: ignoring message from unexpected slave instance ' + slaveId);
    }
};
Cluster.prototype.emitWhenAllSlavesInState_ = function(state) {
    var allSlavesInSameState = true;
    util.forEach(this.slaveState_, function(id, s) {
        if (s.state !== state && s.alive) {
            allSlavesInSameState = false;
        }
    });
    if (allSlavesInSameState) {
        this.emit(state);
    }
};var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var installRemoteHandler = require('./slavenode').installRemoteHandler;
var HTTP_SERVER = require('../http').HTTP_SERVER;
}

// Install the handler for /remote for the global HTTP server
installRemoteHandler(HTTP_SERVER);// ------------------------------------
// Distributed Load Testing Interface
// ------------------------------------
//
// This file defines LoadTestCluster.
//
// This file defines the interface for distributing a load test across multiple machines. Load tests are
// defined through a specification identical to those used by loadtesting.js#run(). To run a distributed
// test, first start nodeload on the slave machines, then initiate the test from the master.
//
//      remote-slave-1> nodeload.js
//      Started HTTP server on remote-slave-1:8000.
//
//      remote-slave-2> nodeload.js
//      Started HTTP server on remote-slave-2:8000.
//      
//      master> edit remote-test.js
//          # var nl = require('nodeload');
//          # var cluster = new nl.LoadTestCluster('master:8000', ['remote-slave-1:8000', 'remote-slave-2:8000']);
//          # cluster.run({ ... test specification ... });
//
// See examples/remotetesting.ex.js for a full example.
//
/*jslint forin:true */
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var stats = require('../stats');
var reporting = require('../reporting');
var run = require('../loadtesting').run;
var Cluster = require('./cluster').Cluster;
var EventEmitter = require('events').EventEmitter;
var StatsLogger = require('../monitoring/statslogger').StatsLogger;
var Report = reporting.Report;
var qputs = util.qputs;

var REPORT_MANAGER = reporting.REPORT_MANAGER;
var NODELOAD_CONFIG = require('../config').NODELOAD_CONFIG;
}

/** A LoadTestCluster consists of a master and multiple slave instances of nodeload. Use
LoadTestCluster.run() accepts the same parameters as loadtesting.js#run(). It runs starts the load test
on each of slaves and aggregates statistics from each of them.

@param masterHost 'host:port' to use for slaves to communicate with this nodeload instance.
@param slaveHosts ['host:port', ...] of slave nodeload instances
@param masterHttpServer the http.js#HttpServer instance that will receive mesages from slaves. Defaults
        to global HTTP_SERVER.
@param slaveUpdateInterval Number of milliseconds between each 'update' event (which contains the latest
        statistics) from this cluster and also the the interval at which each slaves should ping us to
        let us know it is still alive.
        
LoadTestCluster emits the following events:
- 'start': All of the slaves have started executing the load test after a call to run()
- 'update', interval, stats: Emitted periodically with aggregate stats from the last interval and overall stats
- 'end': All of the slaves have completed executing the load test
*/
var LoadTestCluster = exports.LoadTestCluster = function LoadTestCluster(masterHost, slaveHosts, masterHttpServer, slaveUpdateInterval) {
    EventEmitter.call(this);
    util.PeriodicUpdater.call(this);

    var self = this;
    self.masterHost = masterHost;
    self.slaveHosts = slaveHosts;
    self.masterHttpServer = self.masterHttpServer;
    self.slaveUpdateInterval = slaveUpdateInterval || NODELOAD_CONFIG.MONITOR_INTERVAL_MS;
};
util.inherits(LoadTestCluster, EventEmitter);
/** Same parameters as loadtesting.js#run(). Start a load test on each slave in this cluster */
LoadTestCluster.prototype.run = function(specs) {
    var self = this;
    if (!specs) { throw new Error('No tests.'); }
    if (self.cluster && self.cluster.started()) { throw new Error('Already started.'); }

    self.specs = (specs instanceof Array) ? specs : util.argarray(arguments);
    self.cluster = new Cluster(self.getClusterSpec_());
    self.cluster.on('init', function() {
        self.cluster.on('start', function() {
            self.startTests_();
            self.updateInterval = self.slaveUpdateInterval;
            self.setLoggingEnabled(NODELOAD_CONFIG.LOGS_ENABLED);
        });
        self.cluster.start();
    });
    self.cluster.on('running', function() { 
        self.emit('start'); 
    });
    self.cluster.on('done', function() { 
        self.setLoggingEnabled(false);
        self.updateInterval = 0;
        self.update();
        self.end();
    });
    self.cluster.on('end', function() { 
        self.emit('end');
    });
};
/** Force all slaves to stop running tests */
LoadTestCluster.prototype.end = function() {
    this.cluster.stopTests();
    this.cluster.end();
};
/** Set the file name or stats.js#LogFile object that statistics are logged to; null for default */
LoadTestCluster.prototype.setLogFile = function(logNameOrObject) {
    this.logNameOrObject = logNameOrObject;
};

/** Log statistics each time an 'update' event is emitted */
LoadTestCluster.prototype.setLoggingEnabled = function(enabled) {
    if (enabled) {
        this.logger = this.logger || new StatsLogger(this, this.logNameOrObject).start();
    } else if (this.logger) {
        this.logger.stop();
        this.logger = null;
    }
    return this;
};
/** Emit an 'update' event, add latest to the reports, and clear out stats for next interval */
LoadTestCluster.prototype.update = function() {
    var self = this;
    self.emit('update', self.interval, self.stats);
    util.forEach(self.stats, function(testName, stats) {
        var report = self.reports[testName];
        var interval = self.interval[testName];
        util.forEach(stats, function(statName, stat) {
            util.forEach(stat.summary(), function(name, val) {
                report.summary[testName + ' ' + statName + ' ' + name] = val;
            });
            report.getChart(statName).put(interval[statName].summary());
        });
    });
    util.forEach(self.interval, function(testName, stats) {
        util.forEach(stats, function(statName, stat) {
            stat.clear();
        });
    });
    util.qprint('.');
};
LoadTestCluster.prototype.startTests_ = function() {
    var self = this,
        summarizeStats = function() {
            var summary = {ts: new Date()};
            util.forEach(this, function(testName, stats) {
                summary[testName] = {};
                util.forEach(stats, function(statName, stat) {
                    summary[testName][statName] = stat.summary();
                });
            });
            return summary;
        };

    this.reports = {};
    this.interval = {};
    this.stats = {};
    this.cluster.runTests(this.stringify_(this.specs));
    
    Object.defineProperty(this.stats, 'summary', {
        enumerable: false,
        value: summarizeStats
    });
    Object.defineProperty(this.interval, 'summary', {
        enumerable: false,
        value: summarizeStats
    });
};
/** A custom JSON stringifier that outputs node-compatible JSON which includes functions. */
LoadTestCluster.prototype.stringify_ = function(obj) {
    switch (typeof obj) {
    case 'function':
        return obj.toString();
    case 'object':
        if (obj instanceof Array) {
            var self = this;
            return ['[', obj.map(function(x) { return self.stringify_(x); }), ']'].join('');
        } else if (obj === null) {
            return 'null';
        }
        var ret = ['{'];
        for (var i in obj) {
            ret.push(i + ':' + this.stringify_(obj[i]) + ',');
        }
        ret.push('}');
        return ret.join('');
    case 'number':
        if (isFinite(obj)) {
            return String(obj);
        }
        return 'Infinity';
    default:
        return JSON.stringify(obj);
    }
};
/** Get an actual cluster.js#Cluster definition that will create an local master endpoint and be sent
to the slaves */
LoadTestCluster.prototype.getClusterSpec_ = function() {
    var self = this;
    return {
        master: {
            host: self.masterHost,
            sendStats: function(slaves, slaveId, interval) {
                // slave sends interval = {"test-name": { "stats-name": StatsObject, ...}, ...}
                util.forEach(interval, function(testName, remoteInterval) {
                    if (!self.stats[testName]) {
                        // First time seeing this test. Create cumulative and interval stats and a report.
                        self.stats[testName] = {};
                        self.interval[testName] = {};
                        self.reports[testName] = new Report(testName);
                        REPORT_MANAGER.addReport(self.reports[testName]);
                    }

                    // Merge in data from each stat (e.g. latency, result-codes, etc) from this slave
                    stats.mergeStatsGroups(remoteInterval, self.interval[testName]);
                    stats.mergeStatsGroups(remoteInterval, self.stats[testName]);
                });
            }
        },
        slaves: {
            hosts: self.slaveHosts,
            setup: function() {
                if (typeof BUILD_AS_SINGLE_FILE === 'undefined' || BUILD_AS_SINGLE_FILE === false) {
                    this.nlrun = require('../loadtesting').run;
                } else {
                    this.nlrun = run;
                }
            },
            runTests: function(master, specsStr) {
                var specs;
                try {
                    eval('specs='+specsStr);
                } catch(e) {
                    qputs('WARN: Ignoring invalid remote test specifications: ' + specsStr + ' - ' + e.toString());
                    return;
                }

                if (this.state === 'running') { 
                    qputs('WARN: Already running -- ignoring new test specifications: ' + specsStr);
                    return;
                }

                qputs('Received remote test specifications: ' + specsStr);

                var self = this;
                self.state = 'running';
                self.loadtest = self.nlrun(specs);
                self.loadtest.keepAlive = true;
                self.loadtest.on('update', function(interval, stats) {
                    master.sendStats(interval);
                });
                self.loadtest.on('end', function() {
                    self.state = 'done';
                });
            },
            stopTests: function(master) {
                if (this.loadtest) { this.loadtest.stop(); }
            }
        },
        server: self.masterHttpServer,
        pingInterval: self.slaveUpdateInterval
    };
};