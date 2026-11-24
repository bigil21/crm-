# Two-file recovery drill. No delete or overwrite, no cloud keys or production writes.
[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('Pack','Restore')] [string]$Mode,
  [string]$Photo,[string]$Pdf,[string]$CaseDir,[string]$Downloaded)
$ErrorActionPreference='Stop'
$pilotRoot=Join-Path $env:LOCALAPPDATA 'JobCrest/MediaRecovery'
$entropy=[Text.Encoding]::UTF8.GetBytes('JobCrest recovery pilot v1')
$magic=[Text.Encoding]::ASCII.GetBytes('JCV1')
function Write-New([string]$Path,[byte[]]$Data){
  $f=[IO.File]::Open($Path,'CreateNew','Write','None')
  try { $f.Write($Data,0,$Data.Length) } finally { $f.Dispose() }
}
function Private-Directory([string]$Parent){
  $path=Join-Path $Parent ([Guid]::NewGuid().ToString('N'))
  $dir=New-Item -Path $path -ItemType Directory -ErrorAction Stop
  $sec=[IO.FileSystemAclExtensions]::GetAccessControl($dir)
  $sec.SetAccessRuleProtection($true,$false)
  foreach($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
    $sec.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit, ObjectInherit','None','Allow'))
  }
  [IO.FileSystemAclExtensions]::SetAccessControl($dir,$sec)
  return $dir.FullName
}
function Hash-Bytes([byte[]]$Bytes){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()}
if($Mode -eq 'Pack'){
  if(!(Test-Path -LiteralPath $pilotRoot)){[void][IO.Directory]::CreateDirectory($pilotRoot)}
  $CaseDir=Private-Directory $pilotRoot
  $files=[ordered]@{'roof-photo.png'=$Photo;'estimate.pdf'=$Pdf}
  $records=@{}
  $buf=[IO.MemoryStream]::new()
  $zip=[IO.Compression.ZipArchive]::new($buf,'Create',$true)
  try {foreach($name in $files.Keys){
    $data=[IO.File]::ReadAllBytes($files[$name])
    $records[$name]=@{bytes=$data.Length;sha256=(Hash-Bytes $data)}
    $entry=$zip.CreateEntry($name,'Fastest').Open()
    try{$entry.Write($data)} finally{$entry.Dispose()}
  }} finally{$zip.Dispose()}
  $clear=$buf.ToArray();$buf.Dispose()
  $key=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
  $protected=[Security.Cryptography.ProtectedData]::Protect($key,$entropy,'CurrentUser')
  Write-New (Join-Path $CaseDir 'recovery-key.dpapi') $protected
  $nonce=[Security.Cryptography.RandomNumberGenerator]::GetBytes(12)
  $tag=[byte[]]::new(16);$cipher=[byte[]]::new($clear.Length)
  $aes=[Security.Cryptography.AesGcm]::new($key,16)
  try{$aes.Encrypt($nonce,$clear,$cipher,$tag,$magic)}finally{$aes.Dispose();[Array]::Clear($key);[Array]::Clear($clear)}
  $out=[IO.MemoryStream]::new()
  foreach($part in @($magic,$nonce,$tag,$cipher)){$out.Write($part)}
  $bytes=$out.ToArray();$out.Dispose()
  $archive=Join-Path $CaseDir 'media.jcv'
  Write-New $archive $bytes
  $manifest=@{files=$records;archiveSHA256=(Hash-Bytes $bytes)}
  Write-New (Join-Path $CaseDir 'manifest.json') ([Text.Encoding]::UTF8.GetBytes(($manifest|ConvertTo-Json -Depth 5)))
  @{caseDir=$CaseDir;archive=$archive;size=$bytes.Length;files=$records.Count}|ConvertTo-Json -Compress
}else{
  $dir=[IO.Path]::GetFullPath($CaseDir)
  if([IO.Path]::GetDirectoryName($dir) -ne [IO.Path]::GetFullPath($pilotRoot)){throw 'Invalid recovery case'}
  $manifest=Get-Content -LiteralPath (Join-Path $dir 'manifest.json') -Raw|ConvertFrom-Json -AsHashtable
  $blob=[IO.File]::ReadAllBytes($Downloaded)
  if((Hash-Bytes $blob) -ne $manifest.archiveSHA256 -or [Text.Encoding]::ASCII.GetString($blob,0,4) -ne 'JCV1'){throw 'Archive checksum mismatch'}
  $key=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $dir 'recovery-key.dpapi')),$entropy,'CurrentUser')
  $nonce=[byte[]]::new(12);$tag=[byte[]]::new(16);$cipher=[byte[]]::new($blob.Length-32)
  [Buffer]::BlockCopy($blob,4,$nonce,0,12);[Buffer]::BlockCopy($blob,16,$tag,0,16);[Buffer]::BlockCopy($blob,32,$cipher,0,$cipher.Length)
  $clear=[byte[]]::new($cipher.Length);$aes=[Security.Cryptography.AesGcm]::new($key,16)
  try{$aes.Decrypt($nonce,$cipher,$tag,$clear,$magic)}finally{$aes.Dispose();[Array]::Clear($key)}
  $mem=[IO.MemoryStream]::new($clear,$false)
  $zip=[IO.Compression.ZipArchive]::new($mem,'Read')
  try{
    if($zip.Entries.Count -ne 2){throw 'Unexpected archive contents'}
    $output=Private-Directory $dir
    foreach($name in @('roof-photo.png','estimate.pdf')){
      $entry=$zip.GetEntry($name)
      if(!$entry -or $entry.Length -ne $manifest.files[$name].bytes){throw 'Missing or incorrect file'}
      $content=$entry.Open();$restored=[IO.MemoryStream]::new()
      try{$content.CopyTo($restored);$data=$restored.ToArray()}finally{$content.Dispose();$restored.Dispose()}
      if((Hash-Bytes $data) -ne $manifest.files[$name].sha256){throw 'Restored checksum mismatch'}
      Write-New (Join-Path $output $name) $data
      if((Get-FileHash -LiteralPath (Join-Path $output $name) -Algorithm SHA256).Hash -ne $manifest.files[$name].sha256){throw 'Restored disk checksum mismatch'}
    }
    @{verifiedFiles=2;restoredFolder=$output}|ConvertTo-Json -Compress
  }finally{$zip.Dispose();$mem.Dispose();[Array]::Clear($clear)}
}
