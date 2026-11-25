-- Local demonstration identities only. NO cash grant: Joe Banking owns J$.
INSERT OR IGNORE INTO users(id,email,username,password_hash,password_salt,role,status,verified_at,bank_customer_id) VALUES
 ('demo-alice','alice@example.test','alice','NO_PASSWORD_LOGIN','NO_PASSWORD_LOGIN','member','active',CURRENT_TIMESTAMP,'demo-alice'),
 ('demo-bob','bob@example.test','bob','NO_PASSWORD_LOGIN','NO_PASSWORD_LOGIN','member','active',CURRENT_TIMESTAMP,'demo-bob'),
 ('demo-market-operator','operator@example.test','local.operator','NO_PASSWORD_LOGIN','NO_PASSWORD_LOGIN','administrator','active',CURRENT_TIMESTAMP,NULL);
