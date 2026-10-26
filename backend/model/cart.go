package model

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
	"github.com/redis/go-redis/v9"
)

type RedisCartModel struct{ client *redis.Client }

func NewRedisCartModel(client *redis.Client) repository.CartRepository {
	return &RedisCartModel{client: client}
}

func (m *RedisCartModel) GetCart(ctx context.Context, cartID string) ([]data.CartItem, error) {
	value, err := m.client.Get(ctx, cartKey(cartID)).Result()
	if err == redis.Nil {
		return []data.CartItem{}, nil
	}
	if err != nil {
		return nil, err
	}
	var items []data.CartItem
	if err = json.Unmarshal([]byte(value), &items); err != nil {
		return nil, fmt.Errorf("decode cart: %w", err)
	}
	if items == nil {
		items = []data.CartItem{}
	}
	return items, nil
}

func (m *RedisCartModel) SaveCart(ctx context.Context, cartID string, items []data.CartItem) error {
	value, err := json.Marshal(items)
	if err != nil {
		return err
	}
	return m.client.Set(ctx, cartKey(cartID), value, 0).Err()
}

func (m *RedisCartModel) ClearCart(ctx context.Context, cartID string) error {
	return m.client.Del(ctx, cartKey(cartID)).Err()
}

func cartKey(cartID string) string { return "store:cart:" + cartID }
