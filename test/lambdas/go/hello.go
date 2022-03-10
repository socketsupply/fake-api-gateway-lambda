package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-lambda-go/lambda"
)

type HelloResponse struct {
	StatusCode int    `json:"statusCode"`
	Body       string `json:"body"`
}

func RequestHandler(ctx context.Context, b json.RawMessage) (HelloResponse, error) {
	fmt.Println("hello from lambda")
	fmt.Printf("event %s\n", string(b))

	return HelloResponse{
		StatusCode: 200,
		Body:       "Hello from Lambda! (go)",
	}, nil
}

func main() {
	lambda.Start(RequestHandler)
}
