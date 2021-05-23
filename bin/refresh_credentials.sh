if [ $# -gt 0 ]; then
  AWS_PROFILE="$1"
fi

profile=${AWS_PROFILE-default}
temp_identity=$(aws --profile "$profile" sts get-caller-identity)
account_id=$(echo $temp_identity | jq -r .Account)


role_arn="arn:aws:iam::${account_id}:role/${assumed_role_name}"


request_credentials() {
  credentials=$(
    aws sts assume-role \
      --profile $profile \
      --role-arn $role_arn \
      --role-session-name vscode-session
  )
}

echo "=> requesting temporary credentials"
request_credentials
echo "=> updating ~/.aws/credentials as profile $profile"

access_key_id=$(echo $credentials | jq -r .Credentials.AccessKeyId)
secret_access_key=$(echo $credentials | jq -r .Credentials.SecretAccessKey)
session_token=$(echo $credentials | jq -r .Credentials.SessionToken)

aws configure set aws_access_key_id "$access_key_id"
aws configure set aws_secret_access_key "$secret_access_key"
aws configure set aws_session_token "$session_token"

echo "[OK] done"