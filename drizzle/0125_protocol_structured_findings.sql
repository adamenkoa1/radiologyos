-- Структуровані знахідки конструктора зберігаються поряд із вільним текстом,
-- щоб рушій порівняння E3 мав структурне джерело (авто-динаміка). Колонка
-- похідна/допоміжна; вільний текст лишається клінічним джерелом істини.
ALTER TABLE `protocols` ADD `findings_structured_json` text DEFAULT '' NOT NULL;
--> statement-breakpoint
-- Підписаний зміст лишається незмінним: розширюємо охоронець, щоб і
-- структуровані знахідки не змінювались після підпису/видачі.
DROP TRIGGER IF EXISTS protocols_signed_content_immutable;
--> statement-breakpoint
CREATE TRIGGER protocols_signed_content_immutable
BEFORE UPDATE ON protocols
FOR EACH ROW
WHEN OLD.status IN ('signed','issued') AND (
     NEW.template_key IS NOT OLD.template_key
  OR NEW.method IS NOT OLD.method
  OR NEW.sections_json IS NOT OLD.sections_json
  OR NEW.findings IS NOT OLD.findings
  OR NEW.conclusion IS NOT OLD.conclusion
  OR NEW.recommendations IS NOT OLD.recommendations
  OR NEW.number IS NOT OLD.number
  OR NEW.version IS NOT OLD.version
  OR NEW.author_email IS NOT OLD.author_email
  OR NEW.signed_by IS NOT OLD.signed_by
  OR NEW.signed_at IS NOT OLD.signed_at
  OR NEW.signed_version IS NOT OLD.signed_version
  OR NEW.findings_structured_json IS NOT OLD.findings_structured_json
)
BEGIN
  SELECT RAISE(ABORT, 'signed protocol content is immutable');
END;
