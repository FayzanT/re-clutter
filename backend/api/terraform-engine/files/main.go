// Package main serves a diagram's generated Terraform to the editor. The logic
// is in generic/terraformfiles, where the tests under backend/api/tests reach it.
package main

import (
	"context"
	"os"

	"github.com/Alberta2514640/clutter/backend/api/generic"
	"github.com/Alberta2514640/clutter/backend/api/generic/terraformfiles"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	return terraformfiles.Handle(ctx, request, terraformfiles.Deps{
		Bucket: os.Getenv("S3_BUCKET_NAME"),
		Connect: func(ctx context.Context) (terraformfiles.Database, func(), error) {
			conn, err := generic.PsqlConnect()
			if err != nil {
				return nil, nil, err
			}
			return conn, func() { conn.Close(ctx) }, nil
		},
		NewStore: func(ctx context.Context) (terraformfiles.Store, error) {
			cfg, err := config.LoadDefaultConfig(ctx)
			if err != nil {
				return nil, err
			}
			return s3.NewFromConfig(cfg), nil
		},
	})
}
