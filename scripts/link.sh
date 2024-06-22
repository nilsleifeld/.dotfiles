# Link the dotfiles to the home directory

if ! [ -d ~/.dotfiles ]; then
   echo "dotfiles repo were not found under the path ~/.dotfiles"
   exit 1
fi

ln -s ~/.dotfiles/.gitconfig ~/.gitconfig

ln -s ~/.dotfiles/.config/nvim ~/.config/nvim

mkdir ~/.config/Code/User
ln -s ~/.dotfiles/.config/Code/settings.json ~/.config/Code/User/settings.json
ln -s ~/.dotfiles/.config/Code/keybindings.json ~/.config/Code/User/keybindings.json

mkdir ~/.config/tmux
ln -s ~/.dotfiles/.config/tmux/tmux.conf ~/.config/tmux/tmux.conf

echo "Linking dotfiles done!"
