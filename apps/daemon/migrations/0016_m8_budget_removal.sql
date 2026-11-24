ALTER TABLE `task` DROP COLUMN `budget_usd`;--> statement-breakpoint
UPDATE `task`
SET `status` = 'todo',
    `waiting_reason` = NULL
WHERE `status` = 'waiting_input' AND `waiting_reason` = 'budget';--> statement-breakpoint
UPDATE `task_failure` SET `stage` = 'run' WHERE `stage` = 'budget';
