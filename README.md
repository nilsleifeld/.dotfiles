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

Open tmux and press `Prefix + I` to install the plugins.

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

Install lazygit as git client.

```sh
brew install lazygit
```

## Good to know

In this section I will show you some problems that I have encountered and how I have solved them.

### Enable tap to click in i3 WM

When switching from Gnome or KDE to using i3 tiling window manager on a laptop, you might be frustrated to discover that tap-to-click on your touchpad no longer functions. This is how to re-enable tap-to-click in i3 by properly using X11 configuration.

Here’s the command to run if you’re of the tl;dr persuasion:

```sh
sudo mkdir -p /etc/X11/xorg.conf.d && sudo tee <<'EOF' /etc/X11/xorg.conf.d/90-touchpad.conf 1> /dev/null
Section "InputClass"
        Identifier "touchpad"
        MatchIsTouchpad "on"
        Driver "libinput"
        Option "Tapping" "on"
EndSection

EOF
```

Then log out and log back in, or reboot.

Your find the full article [here](https://cravencode.com/post/essentials/enable-tap-to-click-in-i3wm/).

### Brightness control on i3

When the brightness keys are pressed, the brightness is not changed follow the instructions below. The original article can be found [here](https://sourabhtk37.github.io/blog/post/brightness-and-volume-control-i3/).

Install xbacklight.

```sh
sudo apt install brightnessctl
```

The the following lines in your i3 config file controls the brightness.

```
bindsym XF86MonBrightnessUp exec --no-startup-id brightnessctl set +10%
bindsym XF86MonBrightnessDown exec --no-startup-id brightnessctl set 10%-
```

- Find out the drivers for backlight that is present in your system with:

```sh
sudo find /sys/ -type f -iname 'brightness'
```

This will give you a hint to the drivers you have. Mine was an intel_backlight(others can be acpi_video0) with symlink to /sys/class/backlight/intel_backlight/brightness.

- Change file mod bits so that it can be writable. For that do:

```sh
sudo chmod a+rw /sys/class/backlight/intel_backlight/brightness
```
