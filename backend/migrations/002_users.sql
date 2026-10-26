SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
 id INT NOT NULL AUTO_INCREMENT,
 username VARCHAR(255) NOT NULL,
 password VARCHAR(255) NOT NULL,
 email VARCHAR(255) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (id),
 UNIQUE KEY users_username_unique (username),
 UNIQUE KEY users_email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS roles (
 id BIGINT NOT NULL AUTO_INCREMENT,
 name VARCHAR(64) NOT NULL,
 description VARCHAR(255) NOT NULL DEFAULT '',
 PRIMARY KEY (id),
 UNIQUE KEY roles_name_unique (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `groups` (
 id BIGINT NOT NULL AUTO_INCREMENT,
 name VARCHAR(64) NOT NULL,
 description VARCHAR(255) NOT NULL DEFAULT '',
 PRIMARY KEY (id),
 UNIQUE KEY groups_name_unique (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_roles (
 user_id INT NOT NULL,
 role_id BIGINT NOT NULL,
 PRIMARY KEY (user_id, role_id),
 CONSTRAINT user_roles_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT user_roles_role_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_groups (
 user_id INT NOT NULL,
 group_id BIGINT NOT NULL,
 PRIMARY KEY (user_id, group_id),
 CONSTRAINT user_groups_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT user_groups_group_fk FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO roles (name, description) VALUES
('customer', 'Khách hàng mua sắm'),
('admin', 'Quản trị viên cửa hàng');

INSERT IGNORE INTO `groups` (name, description) VALUES
('customers', 'Nhóm khách hàng'),
('administrators', 'Nhóm quản trị cửa hàng');
