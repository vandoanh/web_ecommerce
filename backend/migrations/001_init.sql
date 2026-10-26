SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS products (
 id BIGINT NOT NULL AUTO_INCREMENT,
 sku VARCHAR(64) NOT NULL,
 name VARCHAR(255) NOT NULL,
 description TEXT NOT NULL,
 image_url TEXT NOT NULL,
 price_vnd BIGINT NOT NULL,
 stock INT NOT NULL DEFAULT 0,
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (id),
 UNIQUE KEY products_sku_unique (sku),
 KEY products_active_created_idx (is_active, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
 id BIGINT NOT NULL AUTO_INCREMENT,
 order_number VARCHAR(32) NOT NULL,
 user_id BIGINT NOT NULL,
 total_vnd BIGINT NOT NULL,
 status VARCHAR(32) NOT NULL DEFAULT 'pending',
 recipient_name VARCHAR(255) NOT NULL,
 phone VARCHAR(32) NOT NULL,
 shipping_address TEXT NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (id),
 UNIQUE KEY orders_number_unique (order_number),
 KEY orders_user_created_idx (user_id, created_at),
 KEY orders_status_created_idx (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_items (
 id BIGINT NOT NULL AUTO_INCREMENT,
 order_id BIGINT NOT NULL,
 product_id BIGINT NOT NULL,
 product_name VARCHAR(255) NOT NULL,
 quantity INT NOT NULL,
 unit_price_vnd BIGINT NOT NULL,
 PRIMARY KEY (id),
 KEY order_items_order_idx (order_id),
 CONSTRAINT order_items_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Rename the original demo items in place so existing orders keep their product IDs.
UPDATE products SET sku='FOOD-001', name='Giò lụa truyền thống 500g', description='Giò lụa mềm thơm, phù hợp cho bữa cơm gia đình và mâm cỗ.', image_url='https://images.unsplash.com/photo-1547592180-85f173990554?w=640&auto=format&fit=crop&q=80', price_vnd=145000 WHERE sku='HOME-001';
UPDATE products SET sku='FOOD-002', name='Giò bò tiêu đen 500g', description='Giò bò đậm vị, điểm tiêu đen thơm nhẹ, dùng ngon khi ăn kèm dưa góp.', image_url='https://images.unsplash.com/photo-1544025162-d76694265947?w=640&auto=format&fit=crop&q=80', price_vnd=185000 WHERE sku='HOME-002';
UPDATE products SET sku='FOOD-003', name='Chả quế 500g', description='Chả quế thơm mùi quế, dùng ăn cùng cơm, bánh mì hoặc bún.', image_url='https://images.unsplash.com/photo-1608039829572-78524f79c4c7?w=640&auto=format&fit=crop&q=80', price_vnd=165000 WHERE sku='TECH-001';
UPDATE products SET sku='FOOD-004', name='Pa-tê gan heo 250g', description='Pa-tê béo thơm, tiện dùng với bánh mì hoặc chuẩn bị bữa sáng.', image_url='https://images.unsplash.com/photo-1509440159596-0249088772ff?w=640&auto=format&fit=crop&q=80', price_vnd=85000 WHERE sku='LIFE-001';

INSERT IGNORE INTO products (sku,name,description,image_url,price_vnd,stock) VALUES
('FOOD-001','Giò lụa truyền thống 500g','Giò lụa mềm thơm, phù hợp cho bữa cơm gia đình và mâm cỗ.','https://images.unsplash.com/photo-1547592180-85f173990554?w=640&auto=format&fit=crop&q=80',145000,35),
('FOOD-002','Giò bò tiêu đen 500g','Giò bò đậm vị, điểm tiêu đen thơm nhẹ, dùng ngon khi ăn kèm dưa góp.','https://images.unsplash.com/photo-1544025162-d76694265947?w=640&auto=format&fit=crop&q=80',185000,18),
('FOOD-003','Chả quế 500g','Chả quế thơm mùi quế, dùng ăn cùng cơm, bánh mì hoặc bún.','https://images.unsplash.com/photo-1608039829572-78524f79c4c7?w=640&auto=format&fit=crop&q=80',165000,12),
('FOOD-004','Pa-tê gan heo 250g','Pa-tê béo thơm, tiện dùng với bánh mì hoặc chuẩn bị bữa sáng.','https://images.unsplash.com/photo-1509440159596-0249088772ff?w=640&auto=format&fit=crop&q=80',85000,50);
