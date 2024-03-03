#!/bin/bash

cd ~/.dotfiles

ln -s ~/.dotfiles/.gitconfig ~/.gitconfig
ln -s ~/.dotfiles/.config/nvim ~/.config/nvim

echo "Dotfiles installation complete!"
