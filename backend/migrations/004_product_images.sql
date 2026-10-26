CREATE TABLE IF NOT EXISTS product_images (
 id BIGINT NOT NULL AUTO_INCREMENT,
 product_id BIGINT NOT NULL,
 image_url TEXT NOT NULL,
 sort_order INT NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (id),
 KEY product_images_product_idx (product_id, sort_order),
 CONSTRAINT product_images_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
