import json

def lambda_handler(event, context):
    print('python hello')

    # TODO implement
    return {
        'statusCode': 200,
        'body': json.dumps('Hello from Lambda! (python)')
    }
