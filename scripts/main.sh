#!/bin/bash

cd ~/.dotfiles

ln -s ~/.dotfiles/.gitconfig ~/.gitconfig
ln -s ~/.dotfiles/.config/nvim ~/.config/nvim


unzip ~/.dotfiles/.fonts/JetBrainsMono.zip -d ~/.dotfiles/.fonts
ln -s ~/.dotfiles/.fonts ~/.fonts
fc-cache -f -v

echo "Dotfiles installation complete!"
