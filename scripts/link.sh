# Link the dotfiles to the home directory

if ! [ -d ~/.dotfiles ]; then
   echo "dotfiles repo were not found under the path ~/.dotfiles"
   exit 1
fi

rm ~/.gitconfig
ln -s ~/.dotfiles/.gitconfig ~/.gitconfig

rm ~/.config/nvim
ln -s ~/.dotfiles/.config/nvim ~/.config/nvim

mkdir ~/.config/Code/User
rm ~/.config/Code/User/settings.json
ln -s ~/.dotfiles/.config/Code/settings.json ~/.config/Code/User/settings.json
rm ~/.config/Code/User/keybindings.json
ln -s ~/.dotfiles/.config/Code/keybindings.json ~/.config/Code/User/keybindings.json

mkdir ~/.config/tmux
rm ~/.config/tmux/tmux.conf
ln -s ~/.dotfiles/.config/tmux/tmux.conf ~/.config/tmux/tmux.conf

mkdir ~/.config/i3
rm ~/.config/i3/config
ln -s ~/.dotfiles/.config/i3/config ~/.config/i3/config

mkdir ~/.config/i3status
rm ~/.config/i3status/config
ln -s ~/.dotfiles/.config/i3status/config ~/.config/i3status/config

mkdir ~/.config/alacritty
rm ~/.config/alacritty/alacritty.yml
ln -s ~/.dotfiles/.config/alacritty/alacritty.yml ~/.config/alacritty/alacritty.yml

mkdir ~/.config/ghostty
rm ~/.config/ghostty/config
ln -s ~/.dotfiles/.config/ghostty/config ~/.config/ghostty/config

rm -r ~/.config/hypr
ln -s ~/.dotfiles/.config/hypr ~/.config/hypr


rm ~/.p10k.zsh
ln -s ~/.dotfiles/.p10k.zsh ~/.p10k.zsh
rm ~/.zshrc
ln -s ~/.dotfiles/.zshrc ~/.zshrc

echo "Linking dotfiles done!"
