'use strict';
const globalRequire = require;
class LambdaWorker {
    constructor() {
        this.knownGatewayInfos = [];
        this.routes = {};
        this.lambdaFunctions = {};
        this.globalEnv = Object.assign({}, process.env);
    }
    handleMessage(msg) {
        if (typeof msg !== 'object' || !msg) {
            bail('bad data type from parent process: handleMessage');
            return;
        }
        const objMsg = msg;
        const messageType = objMsg['message'];
        // tslint:disable-next-line: prefer-switch
        if (messageType === 'start') {
            const knownGatewayInfos = objMsg['knownGatewayInfos'];
            // tslint:disable-next-line: strict-boolean-expressions
            if (!knownGatewayInfos) {
                bail('bad data type from parent process: start');
                return;
            }
            this.handleStartMessage(knownGatewayInfos);
        }
        else if (messageType === 'event') {
            const id = objMsg['id'];
            if (typeof id !== 'string') {
                bail('bad data type from parent process: event');
                return;
            }
            const eventObject = objMsg['eventObject'];
            if (typeof eventObject !== 'object' ||
                eventObject === null) {
                bail('bad data type from parent process: event');
                return;
            }
            this.handleEventMessage(id, eventObject);
        }
        else if (messageType === 'addRoutes') {
            const routes = objMsg['routes'];
            if (!isStringDictionary(routes)) {
                bail('bad data type from parent process: addRoutes');
                return;
            }
            const id = objMsg['id'];
            if (typeof id !== 'string') {
                bail('bad data type from parent process: addRoutes');
                return;
            }
            const env = objMsg['env'];
            if (!isStringDictionary(env)) {
                bail('bad data type from parent process: addRoutes');
                return;
            }
            this.addRoutes(id, routes, env);
        }
        else if (messageType === 'removeRoutes') {
            const id = objMsg['id'];
            if (typeof id !== 'string') {
                bail('bad data type from parent process: removeRoutes');
                return;
            }
            this.removeRoutes(id);
        }
        else {
            bail('bad data type from parent process: unknown');
        }
    }
    removeRoutes(id) {
        let foundIndex = -1;
        for (let i = 0; i < this.knownGatewayInfos.length; i++) {
            const r = this.knownGatewayInfos[i];
            if (r.id === id) {
                foundIndex = i;
                break;
            }
        }
        if (foundIndex === -1) {
            bail('cannot removeRoutes for route that we do not know about');
            return;
        }
        this.knownGatewayInfos.splice(foundIndex, 1);
        this.rebuildRoutes();
        this.rebuildEnv();
    }
    addRoutes(id, routes, env) {
        this.knownGatewayInfos.push({
            id, routes, env
        });
        /**
         * Import to initialize the ENV of this worker before
         * actually requiring the lambda code.
         */
        this.rebuildEnv();
        for (const key of Object.keys(routes)) {
            const lambdaFile = routes[key];
            this.lambdaFunctions[lambdaFile] =
                // tslint:disable-next-line: non-literal-require
                require(lambdaFile);
        }
        /**
         * We want the semantics of reloading the lambdas every
         * time addRoutes is send to the worker process.
         *
         * This means every time a new ApiGatewayLambdaServer
         * is created we re-load the lambda and re-evaluate
         * the startup logic in it.
         */
        for (const key of Object.keys(globalRequire.cache)) {
            globalRequire.cache[key].children = [];
            // tslint:disable-next-line: no-dynamic-delete
            delete globalRequire.cache[key];
        }
        this.rebuildRoutes();
    }
    rebuildRoutes() {
        /**
         * Copy over route definition with last write wins confict
         * resolution.
         */
        const result = {};
        for (const info of this.knownGatewayInfos) {
            const routes = info.routes;
            for (const key of Object.keys(routes)) {
                result[key] = routes[key];
            }
        }
        this.routes = result;
    }
    handleStartMessage(knownGatewayInfos) {
        for (const info of knownGatewayInfos) {
            this.addRoutes(info.id, info.routes, info.env);
        }
    }
    handleEventMessage(id, eventObject) {
        const path = eventObject['path'];
        if (typeof path !== 'string') {
            bail('bad data type from parent process');
            return;
        }
        const routePrefixes = Object.keys(this.routes);
        for (const route of routePrefixes) {
            if (path.startsWith(route)) {
                const fnName = this.routes[route];
                const lambda = this.lambdaFunctions[fnName];
                if (!lambda) {
                    bail('could not find lambda ...');
                    return;
                }
                this.invokeLambda(id, eventObject, lambda);
                return;
            }
        }
        // console.log(':(');
        this.sendResult(id, {
            isBase64Encoded: false,
            statusCode: 404,
            headers: {},
            body: 'Not Found',
            multiValueHeaders: {}
        });
    }
    rebuildEnv() {
        const envCopy = Object.assign({}, this.globalEnv);
        for (const info of this.knownGatewayInfos) {
            Object.assign(envCopy, info.env);
        }
        /**
         * We overwrite the environment of the entire process
         * here.
         *
         * This is done so that you can configure the environment
         * variables when "invoking" or "spawning" the lambda
         * from the FakeApiGatewayLambda class.
         *
         * This is the primary vehicle for passing arguments into
         * the lambda when writing tests.
         */
        process.env = envCopy;
    }
    invokeLambda(id, eventObject, fn) {
        /**
         * @raynos TODO: We have to populate the lambda eventObject
         * here and we have not done so at all.
         */
        /**
         * @raynos TODO: We have to pretend to be lambda here.
         * We need to set a bunch of global environment variables.
         *
         * There are other lambda emulation modules that have
         * reference examples of how to "pretend" to be lambda
         * that we can borrow implementations from.
         */
        const maybePromise = fn.handler(eventObject, {}, (err, result) => {
            if (!result) {
                this.sendError(id, err);
                return;
            }
            this.sendResult(id, result);
        });
        if (maybePromise) {
            maybePromise.then((result) => {
                this.sendResult(id, result);
            }, (err) => {
                this.sendError(id, err);
            });
        }
    }
    sendError(id, err) {
        /**
         * @raynos TODO: We should identify what AWS lambda does here
         * in co-ordination with AWS API Gateway and return that
         * instead.
         */
        this.sendResult(id, {
            isBase64Encoded: false,
            statusCode: 500,
            headers: {},
            body: 'fake-api-gateway-lambda: ' +
                'Lambda rejected promise: ' + err.message,
            multiValueHeaders: {}
        });
    }
    sendResult(id, result) {
        // tslint:disable-next-line: no-unbound-method
        if (typeof process.send !== 'function') {
            bail('cannot send to parent process');
            return;
        }
        process.send({
            message: 'result',
            id,
            result: {
                isBase64Encoded: result.isBase64Encoded || false,
                statusCode: result.statusCode,
                // tslint:disable-next-line: strict-boolean-expressions
                headers: result.headers || {},
                body: result.body || '',
                multiValueHeaders: result.multiValueHeaders
            }
        });
    }
}
function isStringDictionary(v) {
    if (typeof v !== 'object' || !v) {
        return false;
    }
    const vObj = v;
    for (const key of Object.keys(vObj)) {
        if (typeof vObj[key] !== 'string') {
            return false;
        }
    }
    return true;
}
function main() {
    const worker = new LambdaWorker();
    process.on('message', (msg) => {
        worker.handleMessage(msg);
    });
}
function bail(msg) {
    process.stderr.write('fake-api-gateway-lambda: ' +
        'The lambda process has to exit because: ' +
        msg + '\n', () => {
        process.exit(1);
    });
}
main();
//# sourceMappingURL=worker.js.map