$word = New-Object -ComObject Word.Application
If ($word) {
    Write-Output "Word is available"
    $word.Quit()
} Else {
    Write-Output "Word is not available"
}
