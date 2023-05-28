var EventEmitter = require("events").EventEmitter;

var slice = Array.prototype.slice;

function reEmit(oriEmitter, newEmitter) {
	var oriEmit = oriEmitter.emit, newEmit = newEmitter.emit;
	oriEmitter.emit = function() {
		newEmit.apply(newEmitter, arguments);
		oriEmit.apply(oriEmitter, arguments);
	};
}

module.exports = function limit(fn, ctx) {
	var _to = 1, _per = -1, _fuzz = 0, _evenly = false, _maxQueueLength = 5000;
	var pastExecs = [], queue = [], timer;

	var pump = function() {
		var now = Date.now();

		pastExecs = pastExecs.filter(function(time) { return (now - time < _per); });

		while(pastExecs.length < _to && queue.length > 0) {
			pastExecs.push(now);

			var tmp = queue.shift();
			var rtn = fn.apply(ctx, tmp.args);
			tmp.emitter.emit("limiter-exec", rtn);

			if(rtn && rtn.emit) { reEmit(rtn, tmp.emitter); }

			if(_evenly) { break; } // Ensures only one function is executed every pump
		}

		if(pastExecs.length <= 0) { timer = null; }
		else if(queue.length <= 0) { // Clear pastExec array when queue is empty asap
			var lastIdx = pastExecs.length - 1;
			timer = setTimeout(pump, _per - (now - pastExecs[lastIdx]));
		} else if(_per > -1) {
			var delay = (_evenly ? _per / _to : _per - (now - pastExecs[0]));
			delay += (delay * _fuzz * Math.random()) | 0;
			timer = setTimeout(pump, delay);
		}
	};

	var limiter = function() {
		if(_maxQueueLength <= queue.length) {
			throw new Error(`Max queue length (${_maxQueueLength}) exceeded`);
		}

		var emitter = new EventEmitter();

		queue.push({ emitter: emitter, args: slice.call(arguments, 0) });

		if(!timer) { timer = setImmediate(pump); }

		return emitter;
	};
	Object.defineProperty(limiter, "length", {value: fn.length}); // Make limiter look more like fn

	limiter.to = function(count) { _to = count || 1; return limiter; };
	limiter.per = function(time) { _per = time || -1; return limiter; };
	limiter.evenly = function(evenly) { _evenly = (evenly == null) || evenly; return limiter; };
	limiter.withFuzz = function(fuzz) { _fuzz = fuzz || 0.1; return limiter; };
	limiter.maxQueueLength = function(max) { _maxQueueLength = max; return limiter; };

	/* Add support for Promises */
	limiter.promise = function(promise) {
		var res = null;
		var rej = null;

		var lim = limiter(options => {
			promise(options)
				.then(function(result) { 
					res(result);
				})
				.catch(function(err) { 
					rej(err);
				})
		});
		var promiseWrapper = new Promise(function(resolve, reject) {
			res = resolve;
			rej = reject;
		});

		// return value
		var self = function(options) { 
			lim(options);
			return promiseWrapper;
		}
		self.to = function(to) { 
			lim.to(to); 
			return self;
		}
		self.per = function(per) { 
			lim.per(per); 
			return self;
		}
		return self;
	}

	return limiter;
};
