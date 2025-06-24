return {
	"ThePrimeagen/harpoon",
	branch = "harpoon2",
	dependencies = { "nvim-lua/plenary.nvim" },
	config = function()
		local harpoon = require("harpoon")

		harpoon:setup()

		vim.keymap.set("n", "<leader>ha", function()
			harpoon:list():append()
		end, { desc = "Append file to Harpoon" })
		vim.keymap.set("n", "<leader>hl", function()
			harpoon.ui:toggle_quick_menu(harpoon:list())
		end, { desc = "Toggle Harpoon menu" })

		vim.keymap.set("n", "<leader><tab>", function()
			harpoon:list():next({
				ui_nav_wrap = true,
			})
		end, { desc = "Next Harpoon window" })
	end,
}
