#!/bin/bash

if ! [ -d ~/.dotfiles ]; then
   echo "dotfiles repo were not found under the path ~/.dotfiles"
   exit 1
fi

cd ~/.dotfiles

# zsh
sudo apt install zsh -y

sudo sudo chsh -s /bin/zsh
sudo sudo chsh -s /bin/zsh nils

rm -rf ~/.oh-my-zsh

git clone https://github.com/ohmyzsh/ohmyzsh.git ~/.oh-my-zsh
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-completions ${ZSH_CUSTOM:-${ZSH:-~/.oh-my-zsh}/custom}/plugins/zsh-completions
git clone https://github.com/zsh-users/zsh-syntax-highlighting ${ZSH_CUSTOM:-${ZSH:-~/.oh-my-zsh}/custom}/plugins/zsh-syntax-highlighting

rm ~/.p10k.zsh
rm ~/.zshrc

ln -s ~/.dotfiles/.p10k.zsh ~/.p10k.zsh
ln -s ~/.dotfiles/.zshrc ~/.zshrc
# zsh

ln -s ~/.dotfiles/.gitconfig ~/.gitconfig
ln -s ~/.dotfiles/.config/nvim ~/.config/nvim
ln -s ~/.dotfiles/.config/alacritty ~/.config/alacritty

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
