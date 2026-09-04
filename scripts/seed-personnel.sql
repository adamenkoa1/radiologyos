-- Одноразовий seed особового складу ВПД/ПРК в/ч А3120 (org 1).
-- Ідемпотентний: INSERT OR IGNORE / ON CONFLICT DO NOTHING — не перезаписує наявні акаунти й PIN-и.
-- Вхід: номер телефону (без +38) + 6-значний PIN (рік+місяць народження).
-- Виконується кроком деплою (не входить у drizzle-міграції, щоб не засмічувати тести).

INSERT OR IGNORE INTO staff_members (email, phone, display_name, last_name, first_name, patronymic, contact_email, military_rank, position_title, role, active, password_hash) VALUES ('380972808899@phone.local', '380972808899', 'Адаменко Дмитро Миколайович', 'Адаменко', 'Дмитро', 'Миколайович', 'adamenko1974@gmail.com', 'майор м/с', 'Начальник ВПД / ТВО ПРК', 'admin', 1, 'pbkdf2$sha256$100000$Ioi7c0xRgjUx69Vksz/4UQ==$LQPX8yK0o36l2DLRTNN4sjZR5n5ita8YKrPXXU02ziU=');
INSERT INTO memberships (organization_id, member_email, role, active) VALUES (1, '380972808899@phone.local', 'admin', 1) ON CONFLICT(organization_id, member_email) DO NOTHING;

INSERT OR IGNORE INTO staff_members (email, phone, display_name, last_name, first_name, patronymic, contact_email, military_rank, position_title, role, active, password_hash) VALUES ('380932303060@phone.local', '380932303060', 'Вовк Максим Валентинович', 'Вовк', 'Максим', 'Валентинович', 'maksvovk08@gmail.com', 'працівник ЗСУ', 'Лікар-рентгенолог', 'radiologist', 1, 'pbkdf2$sha256$100000$vbebbIqagYnkDVLYZaQCTQ==$0Gr/ys1MID+Jwpv6JNWIlmaJqQXTpofx8WY6ppIRjRQ=');
INSERT INTO memberships (organization_id, member_email, role, active) VALUES (1, '380932303060@phone.local', 'radiologist', 1) ON CONFLICT(organization_id, member_email) DO NOTHING;

INSERT OR IGNORE INTO staff_members (email, phone, display_name, last_name, first_name, patronymic, contact_email, military_rank, position_title, role, active, password_hash) VALUES ('380630265112@phone.local', '380630265112', 'Бобро Василь Володимирович', 'Бобро', 'Василь', 'Володимирович', 'vasiliy.bobro1997@gmail.com', 'солдат', 'Рентгенолаборант', 'radiographer', 1, 'pbkdf2$sha256$100000$Wb7vvCeQtzHiIyDPIrYvVA==$nmwkqUuXpe7rI/OC7s4kAn7hiYr7tpzASINB2jvQawk=');
INSERT INTO memberships (organization_id, member_email, role, active) VALUES (1, '380630265112@phone.local', 'radiographer', 1) ON CONFLICT(organization_id, member_email) DO NOTHING;

INSERT OR IGNORE INTO staff_members (email, phone, display_name, last_name, first_name, patronymic, contact_email, military_rank, position_title, role, active, password_hash) VALUES ('380978887100@phone.local', '380978887100', 'Бендік Анатолій Володимирович', 'Бендік', 'Анатолій', 'Володимирович', 'anatolyavladimirovich2016@gmail.com', 'майстер-сержант', 'Рентгенолаборант', 'radiographer', 1, 'pbkdf2$sha256$100000$7OmoG9mMyx4NcultMyLdig==$I118CrOz7tdybLb6IW1X/OxK08+CEp11O9xlf+NnZOc=');
INSERT INTO memberships (organization_id, member_email, role, active) VALUES (1, '380978887100@phone.local', 'radiographer', 1) ON CONFLICT(organization_id, member_email) DO NOTHING;

INSERT OR IGNORE INTO staff_members (email, phone, display_name, last_name, first_name, patronymic, contact_email, military_rank, position_title, role, active, password_hash) VALUES ('380633666038@phone.local', '380633666038', 'Вовкушевський Олексій Олександрович', 'Вовкушевський', 'Олексій', 'Олександрович', 'vovkushevskij32@gmail.com', 'молодший сержант', 'Рентгенолаборант', 'radiographer', 1, 'pbkdf2$sha256$100000$NkSkTbQGfDmz1ko1GJG6BQ==$RaTcIfv0YfiuVGnX208R8bEjRiYnm13KNsG3DjFiqkM=');
INSERT INTO memberships (organization_id, member_email, role, active) VALUES (1, '380633666038@phone.local', 'radiographer', 1) ON CONFLICT(organization_id, member_email) DO NOTHING;

INSERT OR IGNORE INTO staff_members (email, phone, display_name, last_name, first_name, patronymic, contact_email, military_rank, position_title, role, active, password_hash) VALUES ('380936785734@phone.local', '380936785734', 'Чечітко Максим Григорович', 'Чечітко', 'Максим', 'Григорович', 'mcecitko@gmail.com', 'солдат', 'Рентгенолаборант', 'radiographer', 1, 'pbkdf2$sha256$100000$/kdqRI27kZE4AYD9q4KsNg==$wQV8YzTn/Pdqc4mX35rvoxzoNqw70Uwh20aAdu8n9SE=');
INSERT INTO memberships (organization_id, member_email, role, active) VALUES (1, '380936785734@phone.local', 'radiographer', 1) ON CONFLICT(organization_id, member_email) DO NOTHING;

INSERT OR IGNORE INTO staff_members (email, phone, display_name, last_name, first_name, patronymic, contact_email, military_rank, position_title, role, active, password_hash) VALUES ('380996452608@phone.local', '380996452608', 'Золотавіна Ірина Анатоліївна', 'Золотавіна', 'Ірина', 'Анатоліївна', 'zolotavinairina506@gmail.com', 'молодший сержант', 'Молодша медична сестра', 'registrar', 1, 'pbkdf2$sha256$100000$tAScg2Ra+uFSECWo2lbY2A==$MsKv88vM+6R4zo4C2KwAZyKFvgh666zGO24fkzUhtXk=');
INSERT INTO memberships (organization_id, member_email, role, active) VALUES (1, '380996452608@phone.local', 'registrar', 1) ON CONFLICT(organization_id, member_email) DO NOTHING;

