'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const tape = require("tape");
const tapeCluster = require("tape-cluster");
const path = require("path");
const node_fetch_1 = require("node-fetch");
const index_1 = require("../src/index");
class TestHarness {
    constructor(options = {}) {
        this.lambda = new index_1.FakeApiGatewayLambda({
            port: 0,
            env: options.env,
            routes: {
                '/hello': path.join(__dirname, 'lambdas', 'hello.js')
            }
        });
    }
    async fetch(url, init) {
        return node_fetch_1.default(`http://${this.lambda.hostPort}${url}`, init);
    }
    async bootstrap() {
        await this.lambda.bootstrap();
    }
    async close() {
        await this.lambda.close();
    }
}
exports.test = tapeCluster(tape, TestHarness);
//# sourceMappingURL=test-harness.js.map