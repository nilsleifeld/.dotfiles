#!/bin/bash

if ! [ -d ~/.dotfiles ]; then
   echo "dotfiles repo were not found under the path ~/.dotfiles"
   exit 1
fi

cd ~/.dotfiles

ln -s ~/.dotfiles/.gitconfig ~/.gitconfig
ln -s ~/.dotfiles/.config/nvim ~/.config/nvim

if [ -d ~/.dotfiles/.fonts ]; then
   echo "[Cache] fonts"
else
   mkdir ~/.dotfiles/.fonts
   wget -P ~/.dotfiles/.fonts https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.zip
   unzip ~/.dotfiles/.fonts/JetBrainsMono.zip -d ~/.dotfiles/.fonts
   ln -s ~/.dotfiles/.fonts ~/.fonts
   fc-cache -f -v
fi

echo "Dotfiles installation complete!"
