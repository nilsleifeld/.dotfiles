# .dotfiles

My personal dotfiles for a macOS development environment.

The setup currently includes configurations for:

- [Ghostty](https://ghostty.org/)
- [Neovim](https://neovim.io/)
- [tmux](https://github.com/tmux/tmux)
- Zsh with [Oh My Zsh](https://ohmyz.sh/) and [Powerlevel10k](https://github.com/romkatv/powerlevel10k)
- Visual Studio Code
- [pi](https://github.com/badlogic/pi-mono)

## Installation

> [!WARNING]
> The scripts are intended for macOS and may replace existing configuration files. Review them before running.

### 1. Install Homebrew

Install [Homebrew](https://brew.sh/) if it is not already available:

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Clone the repository

```sh
git clone https://github.com/nilsleifeld/.dotfiles.git ~/.dotfiles
cd ~/.dotfiles
```

### 3. Install applications and command-line tools

```sh
sh scripts/mac.sh
```

This installs the tools used by this setup, including Neovim, tmux, Ghostty, lazygit, fzf, ripgrep, yazi, Visual Studio Code and Obsidian.

### 4. Set up Zsh and tmux

```sh
sh scripts/zsh.sh
sh scripts/tmux.sh
```

After starting tmux, press `Prefix + I` to install the tmux plugins.

### 5. Link the dotfiles

```sh
sh scripts/link.sh
sh scripts/gitconfig.sh
```

The scripts create symbolic links from this repository to the corresponding locations in the home directory.

## Font

The terminal and Powerlevel10k work best with a Nerd Font. For example:

```sh
brew install --cask font-jetbrains-mono-nerd-font
```
