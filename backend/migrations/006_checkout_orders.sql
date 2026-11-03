SET NAMES utf8mb4;

ALTER TABLE orders
  ADD COLUMN payment_method VARCHAR(16) NOT NULL DEFAULT 'cod' AFTER status;

CREATE TABLE IF NOT EXISTS order_idempotency (
  user_id INT NOT NULL,
  idempotency_key CHAR(36) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  order_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, idempotency_key),
  UNIQUE KEY order_idempotency_order_unique (order_id),
  KEY order_idempotency_created_idx (created_at),
  CONSTRAINT order_idempotency_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT order_idempotency_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
