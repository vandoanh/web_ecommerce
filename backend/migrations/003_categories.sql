SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS categories (
 id BIGINT NOT NULL AUTO_INCREMENT,
 name VARCHAR(120) NOT NULL,
 slug VARCHAR(140) NOT NULL,
 description VARCHAR(500) NOT NULL DEFAULT '',
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (id),
 UNIQUE KEY categories_name_unique (name),
 UNIQUE KEY categories_slug_unique (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS product_categories (
 product_id BIGINT NOT NULL,
 category_id BIGINT NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (product_id, category_id),
 KEY product_categories_category_idx (category_id, product_id),
 CONSTRAINT product_categories_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
 CONSTRAINT product_categories_category_fk FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO categories (name, slug, description) VALUES
('Giò chả', 'gio-cha', 'Các loại giò, chả truyền thống'),
('Pa-tê', 'pa-te', 'Pa-tê và các món ăn kèm');

INSERT IGNORE INTO product_categories (product_id, category_id)
SELECT p.id, c.id FROM products p JOIN categories c ON c.slug = 'gio-cha'
WHERE p.sku IN ('FOOD-001', 'FOOD-002', 'FOOD-003');

INSERT IGNORE INTO product_categories (product_id, category_id)
SELECT p.id, c.id FROM products p JOIN categories c ON c.slug = 'pa-te'
WHERE p.sku = 'FOOD-004';
