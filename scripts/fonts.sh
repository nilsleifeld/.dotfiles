# Install fonts
#
# This script will install the Nerd Fonts JetBrains Mono font 
# and link it to the ~/.fonts directory.

if [ -d ~/.dotfiles/.fonts ]; then
   echo "[Cache] fonts"
else
   mkdir ~/.dotfiles/.fonts
   wget -P ~/.dotfiles/.fonts https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.zip
   unzip ~/.dotfiles/.fonts/JetBrainsMono.zip -d ~/.dotfiles/.fonts
   ln -s ~/.dotfiles/.fonts ~/.fonts
   fc-cache -f -v

   echo "Fonts installed"
fi
