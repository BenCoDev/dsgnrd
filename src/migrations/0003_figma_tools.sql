CREATE TABLE `figma_destinations` (
	`experiment` integer PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`file_key` text NOT NULL,
	`page_id` text NOT NULL,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `figma_destinations_scope_unique` ON `figma_destinations` (`scope`);--> statement-breakpoint
CREATE TABLE `figma_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment` integer NOT NULL,
	`agent` integer NOT NULL,
	`operation_key` text NOT NULL,
	`request` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	FOREIGN KEY (`experiment`) REFERENCES `figma_destinations`(`experiment`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `figma_operations_agent_operation_key_unique` ON `figma_operations` (`agent`,`operation_key`);