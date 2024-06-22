# .dotfiles

This repository contains my dotfiles for my development environment.
Currently I using Pop!\_OS with i3, nvim, tmux and zsh.

## Installation

> [!WARNING] These installation instructions are for Ubuntu-based systems. If you are using a different system, you must change the installation scripts in the ~/.dotfiles/scripts directory.

Clone the repository in your home directory.

```sh
git clone https://github.com/nilsleifeld/.dotfiles.git ~/.dotfiles
```

Link the dotfiles to the home directory.

```sh
sudo ~/.dotfiles/scripts/link.sh
```

Download NordFont.

```sh
sudo ~/.dotfiles/scripts/fonts.sh
```

Currently I using Homebrew for installing packages.
Your can find the installation guide [here](https://brew.sh/).

Install tmux.

```sh
sudo ~/.dotfiles/scripts/tmux.sh
```

Install zsh.

```sh
sudo ~/.dotfiles/scripts/zsh.sh
```

Install nvim.
You find the installation guide [here](https://github.com/neovim/neovim/blob/master/INSTALL.md).

For the fizzy finder you need to install fzf.

```sh
brew install fzf
```

To using the dotnet with nvim you need to install dotnet.

```sh
brew install dotnet
```

Install i3 as window manager and dmenu as application launcher.

```sh
sudo apt install i3 dmenu -y
```

Install alacritty as terminal emulator.

```sh
sudo apt install alacritty -y
```
