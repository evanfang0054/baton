ALTER TABLE `task` ADD `context_json` text;--> statement-breakpoint
DELETE FROM `edge` WHERE `id` NOT IN (SELECT MIN(`id`) FROM `edge` GROUP BY `canvas_id`, `source_id`, `target_id`, `type`);--> statement-breakpoint
CREATE UNIQUE INDEX `edge_unique_idx` ON `edge` (`canvas_id`,`source_id`,`target_id`,`type`);