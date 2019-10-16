# fake-api-gateway-lambda

This is a testing utility for testing your lambda functions.

You pass it your lambda function and it will start an emulated
AWS API Gateway on a HTTP port and it will redirect all HTTP
requests to your lambda function using Lambda proxy integration.

## Example

```js
const path = require('path')
const FakeApiGatewayLambda =
  require('fake-api-gateway-lambda').FakeApiGatewayLambda
const fetch = require('node-fetch')

async function test() {
  const gateway = new FakeApiGatewayLambda({
    port: 0,
    routes: {
      '/hello': path.join(
        __dirname, 'lambdas', 'hello-world', 'index.js'
      ),
      '/contact': path.join(
        __dirname, 'lambdas', 'contact', 'index.js'
      )
    }
  })

  await gateway.bootstrap()

  const resp = await fetch(`http://${gateway.hostPort}/hello`)

  // Payload of the hello-world lambda response.
  const body = await resp.json()

  await gateway.close()
}

process.on('unhandledRejection', (err) => { throw err })
test()
```

## Design

This testing utility strongly couples AWS lambda & AWS Api gateway.

When writing integration tests for your lambdas you want to be able
to author tests like other applications would use your code which
would be through the AWS API gateway API in either the browser
or another application.

Lambda has a very unique execution model, we try to emulate a non
trivial amount of lambda.

The FakeApiGatewayLambda will actually manage a pool of child
processes and will send HTTP req / res to these child processes
so that it can invoke your lambda function, this has similar hot
start & cold start semantics as lambda.

The FakeAPIGatewayLambda will only send one HTTP request to a given
child process at a time ( just like real lambda ), so a given child
process lambda worker can only handle one HTTP request at a time.

You can set the concurrency to some level that makes sense for your
testing needs, the default concurrency is 10 child processes, setting
it higher will spin up multiple child processes.

You can also disable isolation so that you can send 1000 concurrent
requests to a single child process by setting the `forceSingleWorker`
option to true.

## Docs :


## install

```
% npm install fake-api-gateway-lambda
```

## MIT Licensed

