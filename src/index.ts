'use strict';

import * as http from 'http';
import * as util from 'util';
import * as childProcess from 'child_process';
import * as path from 'path';
import * as url from 'url';

import { WaitGroup } from './sync-wait-group';

const WORKER_PATH = path.join(__dirname, 'worker.js');

export interface Callback {
    (err?: Error): void;
}

export interface Dictionary<T> {
    [key: string]: T;
}

export interface Options {
    port?: number;
    env?: Dictionary<string>;
    routes: Dictionary<string>;
}

export interface PendingRequest {
    req: http.IncomingMessage;
    res: http.ServerResponse;
    id: string;
}

interface WorkerInfo {
    proc: childProcess.ChildProcess;
    handlingRequest: boolean;
}

interface WorkerPoolHandler {
    hasPendingRequest(id: string): boolean;
    handleLambdaResult(id: string, result: LambdaResult): void;
}

interface Unrefable {
    unref(): void;
}

class WorkerPool {
    readonly workers: WorkerInfo[];
    private readonly maxWorkers: number;
    private readonly handlers: WorkerPoolHandler[];
    private readonly knownGatewayInfos: {
        id: string,
        routes: Dictionary<string>,
        env: Dictionary<string>
    }[];

    private freeWorkerWG: WaitGroup | null;

    constructor() {
        this.maxWorkers = 10;

        this.workers = [];
        this.knownGatewayInfos = [];
        this.handlers = [];
        this.freeWorkerWG = null;
    }

    register(
        gatewayId: string, routes: Dictionary<string>,
        env: Dictionary<string>,
        handler: WorkerPoolHandler
    ): void {
        this.knownGatewayInfos.push({
            id: gatewayId,
            routes,
            env
        });
        this.handlers.push(handler);

        for (const w of this.workers) {
            w.proc.send({
                message: 'addRoutes',
                id: gatewayId,
                routes,
                env
            });
        }
    }

    deregister(
        gatewayId: string,
        routes: Dictionary<string>,
        _env: Dictionary<string>,
        handler: WorkerPoolHandler
    ): void {
        let index = -1;
        for (let i = 0; i < this.knownGatewayInfos.length; i++) {
            const v = this.knownGatewayInfos[i];
            if (v.routes === routes) {
                index = i;
                break;
            }
        }

        if (index === -1) {
            throw new Error('found weird index');
        }

        this.knownGatewayInfos.splice(index, 1);
        this.handlers.splice(this.handlers.indexOf(handler), 1);

        for (const w of this.workers) {
            w.proc.send({
                message: 'removeRoutes',
                id: gatewayId
            });
        }
    }

    private async getFreeWorker(): Promise<WorkerInfo> {
        for (const w of this.workers) {
            if (!w.handlingRequest) {
                w.handlingRequest = true;
                return w;
            }
        }

        if (this.workers.length < this.maxWorkers) {
            const w = this.spawnWorker();
            w.handlingRequest = true;
            return w;
        }

        await this.waitForFreeWorker();
        return this.getFreeWorker();
    }

    private async waitForFreeWorker(): Promise<void> {
        if (this.freeWorkerWG) {
            return this.freeWorkerWG.wait();
        }

        this.freeWorkerWG = new WaitGroup();
        this.freeWorkerWG.add(1);
        return this.freeWorkerWG.wait();
    }

    async dispatch(
        id: string,
        eventObject: object
    ): Promise<void> {
        const w = await this.getFreeWorker();
        w.proc.send({
            message: 'event',
            id,
            eventObject
        });
    }

    private spawnWorker(): WorkerInfo {
        const proc = childProcess.spawn(
            process.execPath,
            [WORKER_PATH],
            {
                stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
                detached: false
            }
        );

        /**
         * Since this is a workerpool we unref the child processes
         * so that they do not keep the process open. This is because
         * we are pooling these child processes globally between
         * many instances of the FakeApiGatewayLambda instances.
         */
        proc.unref();
        (<Unrefable> <unknown> proc.channel).unref();

        const info = {
            proc,
            handlingRequest: false
        };
        this.workers.push(info);

        if (proc.stdout) {
            (<Unrefable> <unknown> proc.stdout).unref();
            proc.stdout.pipe(process.stdout);
        }
        if (proc.stderr) {
            (<Unrefable> <unknown> proc.stderr).unref();
            proc.stderr.pipe(process.stderr);
        }
        proc.on('message', (msg: Dictionary<unknown>) => {
            this.handleMessage(msg, info);
        });

        proc.once('exit', (code: number) => {
            if (code !== 0) {
                throw new Error('worker process exited non-zero');
            }
        });

        proc.send({
            message: 'start',
            knownGatewayInfos: this.knownGatewayInfos
        });
        return info;
    }

    private handleMessage(
        msg: Dictionary<unknown>,
        info: WorkerInfo
    ): void {
        // tslint:disable-next-line: strict-boolean-expressions
        if (!msg || typeof msg !== 'object') {
            throw new Error('bad data type from child process');
        }

        const messageType = msg['message'];
        if (messageType !== 'result') {
            throw new Error('bad data type from child process');
        }

        const id = msg['id'];
        if (typeof id !== 'string') {
            throw new Error('bad data type from child process');
        }

        const resultObj = msg['result'];
        if (!checkResult(resultObj)) {
            throw new Error('bad data type from child process');
        }

        for (const h of this.handlers) {
            if (h.hasPendingRequest(id)) {
                h.handleLambdaResult(id, resultObj);
                break;
            }
        }

        info.handlingRequest = false;
        if (this.freeWorkerWG) {
            this.freeWorkerWG.done();
            this.freeWorkerWG = null;
        }
    }
}

export class FakeApiGatewayLambda {
    private readonly port: number;
    private readonly routes: Dictionary<string>;
    readonly workerPool: WorkerPool;
    private httpServer: http.Server | null;
    private readonly gatewayId: string;
    private readonly env: Dictionary<string>;
    hostPort: string | null;

    private static readonly WORKER_POOL: WorkerPool = new WorkerPool();

    private readonly pendingRequests: Map<string, PendingRequest>;

    constructor(options: Options) {
        this.httpServer = http.createServer();
        this.port = options.port || 0;
        this.routes = {...options.routes};
        this.env = options.env || {};
        this.hostPort = null;
        this.pendingRequests = new Map();
        this.gatewayId = cuuid();

        this.workerPool = FakeApiGatewayLambda.WORKER_POOL;
    }

    async bootstrap(): Promise<string> {
        if (!this.httpServer) {
            throw new Error('cannot bootstrap closed server');
        }

        this.httpServer.on('request', (
            req: http.IncomingMessage,
            res: http.ServerResponse
        ) => {
            this.handleServerRequest(req, res);
        });

        const server = this.httpServer;
        await util.promisify((cb: Callback) => {
            server.listen(this.port, cb);
        })();

        /**
         * We want to register that these routes should be handled
         * by the following lambdas to the WORKER_POOL.
         */
        this.workerPool.register(
            this.gatewayId,
            this.routes,
            this.env,
            this
        );

        const addr = this.httpServer.address();
        if (!addr || typeof addr === 'string') {
            throw new Error('invalid http server address');
        }

        this.hostPort = `localhost:${addr.port}`;
        return this.hostPort;
    }

    async close(): Promise<void> {
        if (this.httpServer === null) {
            return;
        }

        const server = this.httpServer;
        await util.promisify((cb: Callback) => {
            server.close(cb);
        })();

        /**
         * Here we want to tell the WORKER_POOL to stop routing
         * these URLs to the lambdas.
         */
        this.workerPool.deregister(
            this.gatewayId,
            this.routes,
            this.env,
            this
        );

        this.httpServer = null;
    }

    hasPendingRequest(id: string): boolean {
        return this.pendingRequests.has(id);
    }

    handleLambdaResult(id: string, result: LambdaResult): void {
        const pending = this.pendingRequests.get(id);
        if (!pending) {
            /**
             * @raynos TODO: gracefully handle this edgecase.
             */
            throw new Error('Could not find pending request');
        }

        this.pendingRequests.delete(id);

        const res = pending.res;
        res.statusCode = result.statusCode;

        for (const key of Object.keys(result.headers)) {
            res.setHeader(key, result.headers[key]);
        }
        if (result.multiValueHeaders) {
            for (const key of Object.keys(result.multiValueHeaders)) {
                res.setHeader(key, result.multiValueHeaders[key]);
            }
        }

        if (result.isBase64Encoded) {
            throw new Error('isBase64Encoded is not supported');
        }

        res.end(result.body);
    }

    private handleServerRequest(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): void {
        // tslint:disable-next-line: no-non-null-assertion
        const uriObj = url.parse(req.url!, true);

        let body = '';
        req.on('data', (chunk: string) => {
            body += chunk.toString();
        });
        req.on('end', () => {
            /**
             * @raynos TODO: Need to identify what concrete value
             * to use for `event.resource` and for `event.pathParameters`
             * since these are based on actual configuration in AWS
             * API Gateway. Maybe these should come from the `routes`
             * options object itself
             */
            /**
             * @raynos TODO: Identify how to populate a requestContext
             * object here.
             */
            const eventObject = {
                resource: '/{proxy+}',
                path: req.url,
                httpMethod: req.method,
                headers: flattenHeaders(req.rawHeaders),
                multiValueHeaders: multiValueHeaders(req.rawHeaders),
                queryStringParameters:
                    singleValueQueryString(uriObj.query),
                multiValueQueryStringParameters:
                    multiValueObject(uriObj.query),
                pathParameters: {},
                stageVariables: {},
                requestContext: {},
                body,
                isBase64Encoded: false
            };

            const id = cuuid();
            this.pendingRequests.set(id, {
                req,
                res,
                id
            });
            this.workerPool.dispatch(id, eventObject)
                .catch((err: Error) => {
                    process.nextTick(() => {
                        throw err;
                    });
                });
        });
    }
}

export interface LambdaResult {
    isBase64Encoded: boolean;
    statusCode: number;
    headers: Dictionary<string>;
    multiValueHeaders?: Dictionary<string[]>;
    body: string;
}

function checkResult(
    v: unknown
): v is LambdaResult {
    if (typeof v !== 'object' || !v) {
        return false;
    }

    const objValue = <Dictionary<unknown>> v;
    if (typeof objValue['isBase64Encoded'] !== 'boolean') {
        return false;
    }
    if (typeof objValue['statusCode'] !== 'number') {
        return false;
    }
    if (typeof objValue['headers'] !== 'object') {
        return false;
    }
    // tslint:disable-next-line: strict-boolean-expressions
    if (objValue['multiValueHeaders'] &&
        typeof objValue['multiValueHeaders'] !== 'object'
    ) {
        return false;
    }
    if (typeof objValue['body'] !== 'string') {
        return false;
    }

    return true;
}

function singleValueQueryString(
    qs: Dictionary<string | string[]>
): Dictionary<string> {
    const out: Dictionary<string> = {};
    for (const key of Object.keys(qs)) {
        const v = qs[key];
        out[key] = typeof v === 'string' ? v : v[v.length - 1];
    }
    return out;
}

function multiValueObject(
    h: Dictionary<string | string[] | undefined>
): Dictionary<string[]> {
    const out: Dictionary<string[]> = {};
    for (const key of Object.keys(h)) {
        const v = h[key];
        if (typeof v === 'string') {
            out[key] = [v];
        } else if (Array.isArray(v)) {
            out[key] = v;
        }
    }
    return out;
}

function multiValueHeaders(
    h: string[]
): Dictionary<string[]> {
    const out: Dictionary<string[]> = {};
    for (let i = 0; i < h.length; i += 2) {
        const headerName = h[i];
        const headerValue = h[i + 1];

        if (!(headerName in out)) {
            out[headerName] = [headerValue];
        } else {
            out[headerName].push(headerValue);
        }
    }
    return out;
}

function flattenHeaders(
    h: string[]
): Dictionary<string> {
    const out: Dictionary<string> = {};
    const deleteList: string[] = [];
    for (let i = 0; i < h.length; i += 2) {
        const headerName = h[i];
        const headerValue = h[i + 1];

        if (!(headerName in out)) {
            out[headerName] = headerValue;
        } else {
            deleteList.push(headerName);
        }
    }
    for (const key of deleteList) {
        // tslint:disable-next-line: no-dynamic-delete
        delete out[key];
    }
    return out;
}

function cuuid(): string {
    // tslint:disable-next-line: insecure-random
    const str = (Date.now().toString(16) + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)).slice(0, 32);
    return str.slice(0, 8) + '-' + str.slice(8, 12) + '-' + str.slice(12, 16) + '-' + str.slice(16, 20) + '-' + str.slice(20);
}
