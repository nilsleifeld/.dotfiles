# Install zsh
#
# This script will install zsh and oh-my-zsh 
# with the powerlevel10k theme.

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

echo "Zsh and oh-my-zsh installed!"
