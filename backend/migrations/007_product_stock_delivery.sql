SET NAMES utf8mb4;

ALTER TABLE products ADD COLUMN regular_price_vnd BIGINT NULL AFTER price_vnd;
ALTER TABLE products ADD COLUMN discount_price_vnd BIGINT NULL AFTER regular_price_vnd;
ALTER TABLE products ADD COLUMN discount_starts_at DATETIME(6) NULL AFTER discount_price_vnd;
ALTER TABLE products ADD COLUMN discount_ends_at DATETIME(6) NULL AFTER discount_starts_at;
ALTER TABLE products ADD COLUMN stock_version BIGINT NOT NULL DEFAULT 0 AFTER stock;

UPDATE products SET regular_price_vnd = price_vnd WHERE regular_price_vnd IS NULL;

-- Admin stock-adjustment audit only. Checkout reservation and order
-- cancellation also change products.stock/stock_version, but those movements
-- are represented by orders/order_items and are intentionally not duplicated
-- here. stock_version is an inventory revision counter, not an adjustment count.
CREATE TABLE IF NOT EXISTS stock_adjustments (
 id BIGINT NOT NULL AUTO_INCREMENT,
 product_id BIGINT NOT NULL,
 delta INT NOT NULL,
 stock_before INT NOT NULL,
 stock_after INT NOT NULL,
 stock_version_after BIGINT NOT NULL,
 reason VARCHAR(255) NOT NULL,
 actor_user_id INT NOT NULL,
 idempotency_key CHAR(36) NULL,
 request_hash CHAR(64) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY (id),
 KEY stock_adjustments_product_created_idx (product_id, created_at),
 UNIQUE KEY stock_adjustments_actor_idempotency_unique (actor_user_id, idempotency_key),
 CONSTRAINT stock_adjustments_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
 CONSTRAINT stock_adjustments_actor_fk FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- MySQL only enforces CHECK constraints from 8.0.16 onward. The generated
-- singleton column plus its unique key makes the one-row invariant hold even
-- where CHECK parsing is accepted but ignored (for example MySQL 5.7), while
-- the CHECK remains an additional guard on modern MySQL.
CREATE TABLE IF NOT EXISTS delivery_settings (
 id TINYINT NOT NULL,
 singleton TINYINT GENERATED ALWAYS AS (1) STORED NOT NULL,
 phone VARCHAR(32) NOT NULL DEFAULT '',
 address TEXT NOT NULL,
 map_location TEXT NOT NULL,
 delivery_text TEXT NOT NULL,
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 version BIGINT NOT NULL DEFAULT 1,
 PRIMARY KEY (id),
 UNIQUE KEY delivery_settings_singleton_unique (singleton),
 CONSTRAINT delivery_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO delivery_settings (id, phone, address, map_location, delivery_text, updated_at, version) VALUES (1, '', '', '', '', UTC_TIMESTAMP(6), 1);
