const path = require('path')
const FakeApiGatewayLambda =
  require('../').FakeApiGatewayLambda
// const fetch = require('node-fetch')

async function test () {
  const gateway = new FakeApiGatewayLambda({
    port: 8081,
    env: {
      TEST_SETTINGS: '...',
      TEST_S3_BUCKET: 'some-test-bucket-NOT-PROD',
      TEST_DB_NAME: 'my-app-test'
    },
    routes: {
      '/hello': path.join(
        __dirname, 'hello.js'
      )
    }
  })

  await gateway.bootstrap()
  console.log('gataway running...')
  // const resp = await fetch(`http://${gateway.hostPort}/hello`)

  // Payload of the hello-world lambda response.
  // const body = await resp.json()

  // await gateway.close()
}

test()
