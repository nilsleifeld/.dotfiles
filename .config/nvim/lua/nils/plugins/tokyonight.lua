-- Colorscheme

return {
	-- Change the name of the colorscheme plugin below, and then
	-- change the command in the config to whatever the name of that colorscheme is
	--
	-- If you want to see what colorschemes are already installed, you can use `:Telescope colorscheme`
	"folke/tokyonight.nvim",
	lazy = false, -- make sure we load this during startup if it is your main colorscheme
	priority = 1000, -- make sure to load this before all the other start plugins
	config = function()
		-- Load the colorscheme here
		local dark = false

		local function toggleColorscheme()
			dark = not dark
			if dark then
				vim.cmd.colorscheme("tokyonight-night")
			else
				vim.cmd.colorscheme("tokyonight-day")
			end
		end

		toggleColorscheme()

		vim.keymap.set("n", "<leader>t", function()
			toggleColorscheme()
		end, { desc = "Toggle colorscheme" })

		-- You can configure highlights by doing something like
		vim.cmd.hi("Comment gui=none")
	end,
}
