package config

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

func InitRedis(ctx context.Context, url string) (*redis.Client, error) {
	options, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("parse redis URL: %w", err)
	}
	client := redis.NewClient(options)
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err = client.Ping(pingCtx).Err(); err != nil {
		client.Close()
		return nil, fmt.Errorf("connect redis: %w", err)
	}
	return client, nil
}
