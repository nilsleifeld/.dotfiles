--- Create project-relative file references for use in coding-agent prompts.
---
--- A file reference has the form `@path/to/file.lua`. A visual-mode reference
--- also includes the selected line range, for example `@path/to/file.lua:10-18`.
--- The resulting reference is copied to both the unnamed and system clipboard.
---@module "nils.core.agent_reference"

local M = {}

--- Find the project root for a file.
---@param file string Absolute or relative file path.
---@return string root Project root path.
local function project_root(file)
	local directory = vim.fn.fnamemodify(file, ":h")

	-- Git is optional. Fall back to Neovim's current working directory.
	if vim.fn.executable("git") == 1 then
		local result = vim.fn.systemlist({ "git", "-C", directory, "rev-parse", "--show-toplevel" })

		if vim.v.shell_error == 0 and result[1] and result[1] ~= "" then
			return vim.fs.normalize(result[1])
		end
	end

	return vim.fs.normalize(vim.fn.getcwd())
end

--- Copy a reference for the current buffer to the clipboard.
---@param suffix? string Optional line suffix, such as `:10` or `:10-18`.
---@return nil
local function copy_reference(suffix)
	local file = vim.api.nvim_buf_get_name(0)

	if file == "" then
		vim.notify("The current buffer has no file path.", vim.log.levels.WARN)
		return
	end

	file = vim.fs.normalize(file)
	local root = project_root(file)
	local relative = vim.fs.relpath(root, file) or file
	local reference = "@" .. relative .. (suffix or "")

	vim.fn.setreg("+", reference)
	vim.fn.setreg("*", reference)
	vim.notify("Copied: " .. reference)
end

--- Copy the current file as a project-relative agent reference.
---@return nil
function M.copy_file_reference()
	copy_reference()
end

--- Copy the current visual selection as a project-relative agent reference.
--- The reference includes the first and last selected line.
---@return nil
function M.copy_selection_reference()
	local start_line = vim.fn.getpos("'<")[2]
	local end_line = vim.fn.getpos("'>")[2]

	if start_line > end_line then
		start_line, end_line = end_line, start_line
	end

	local suffix = ":" .. start_line
	if start_line ~= end_line then
		suffix = suffix .. "-" .. end_line
	end

	copy_reference(suffix)
end

return M
